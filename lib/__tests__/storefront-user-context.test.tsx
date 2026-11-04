/**
 * @jest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { StorefrontUserProvider, useStorefrontUser } from '../storefront-user-context';

function Probe() {
  const { user, token, login, logout } = useStorefrontUser();
  return (
    <div>
      <span data-testid="user">{user?.name ?? 'nadie'}</span>
      <span data-testid="token">{token ?? 'sin-token'}</span>
      <button onClick={() => login('ana@correo.co', 'secreta123')}>entrar</button>
      <button onClick={logout}>salir</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <StorefrontUserProvider slug="esquina">
      <Probe />
    </StorefrontUserProvider>
  );

// jsdom no trae Response: respuesta mínima con lo que usa el contexto.
const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('sesión del cliente en la tienda', () => {
  let calls: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    localStorage.clear();
    calls = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/storefront/auth/login')) {
        return reply(200, { user: { id: 'u1', name: 'Ana', email: 'ana@correo.co', createdAt: '', token: 'tok123' } });
      }
      return reply(200, { success: true });
    }) as typeof fetch;
  });

  it('al entrar guarda el código de sesión aparte del usuario', async () => {
    renderProbe();
    await act(async () => screen.getByText('entrar').click());
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('Ana'));
    expect(screen.getByTestId('token').textContent).toBe('tok123');
    expect(localStorage.getItem('storefront_session_esquina')).toBe('tok123');
    expect(JSON.parse(localStorage.getItem('storefront_user_esquina')!)).not.toHaveProperty('token');
  });

  it('una sesión vieja sin código se descarta (hay que entrar de nuevo)', async () => {
    localStorage.setItem('storefront_user_esquina', JSON.stringify({ id: 'u1', name: 'Ana', email: 'a@b.co' }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('nadie'));
    expect(localStorage.getItem('storefront_user_esquina')).toBeNull();
  });

  it('si el Worker ya no reconoce la sesión, se cierra sola', async () => {
    localStorage.setItem('storefront_user_esquina', JSON.stringify({ id: 'u1', name: 'Ana', email: 'a@b.co' }));
    localStorage.setItem('storefront_session_esquina', 'vencido');
    global.fetch = jest.fn(async () => reply(401, {})) as typeof fetch;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('nadie'));
    expect(localStorage.getItem('storefront_session_esquina')).toBeNull();
  });

  it('cerrar sesión borra el código y avisa al Worker', async () => {
    renderProbe();
    await act(async () => screen.getByText('entrar').click());
    await waitFor(() => expect(screen.getByTestId('token').textContent).toBe('tok123'));
    await act(async () => screen.getByText('salir').click());
    expect(localStorage.getItem('storefront_session_esquina')).toBeNull();
    const logoutCall = calls.find((c) => c.url.includes('/auth/logout/esquina'));
    expect(logoutCall?.init?.headers).toMatchObject({ Authorization: 'Bearer tok123' });
  });
});
