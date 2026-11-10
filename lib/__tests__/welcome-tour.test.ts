/**
 * @jest-environment jsdom
 */
import {
  WELCOME_TOUR_META_KEY,
  isWelcomeTourEnabled,
  markShownThisSession,
  wasShownThisSession,
  writeLocalWelcomeTour,
} from '../welcome-tour';

describe('presentación de bienvenida', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('sale a las cuentas creadas desde el lanzamiento', () => {
    expect(isWelcomeTourEnabled({ id: 'u1', createdAt: new Date('2026-11-12T10:00:00-05:00') })).toBe(true);
  });

  it('no sale de golpe a las cuentas viejas', () => {
    expect(isWelcomeTourEnabled({ id: 'u1', createdAt: new Date('2026-06-01T10:00:00-05:00') })).toBe(false);
  });

  it('"No mostrar" (guardado en Clerk) gana sobre la cuenta nueva', () => {
    expect(
      isWelcomeTourEnabled({
        id: 'u1',
        createdAt: new Date('2026-11-12T10:00:00-05:00'),
        unsafeMetadata: { [WELCOME_TOUR_META_KEY]: false },
      })
    ).toBe(false);
  });

  it('una cuenta vieja puede activarla desde Configuración', () => {
    expect(
      isWelcomeTourEnabled({
        id: 'u1',
        createdAt: new Date('2026-06-01T10:00:00-05:00'),
        unsafeMetadata: { [WELCOME_TOUR_META_KEY]: true },
      })
    ).toBe(true);
  });

  it('si Clerk no guardó, respeta la copia local', () => {
    writeLocalWelcomeTour('u1', false);
    expect(isWelcomeTourEnabled({ id: 'u1', createdAt: new Date('2026-11-12T10:00:00-05:00') })).toBe(false);
  });

  it('sale una sola vez por sesión', () => {
    expect(wasShownThisSession('u1')).toBe(false);
    markShownThisSession('u1');
    expect(wasShownThisSession('u1')).toBe(true);
    expect(wasShownThisSession('u2')).toBe(false);
  });
});
