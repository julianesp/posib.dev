'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface StorefrontUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  createdAt: string;
}

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://tienda-pos-api.julii1295.workers.dev';
const userKey = (slug: string) => `storefront_user_${slug}`;
/** Código secreto de la sesión (en la base solo queda su hash). */
const tokenKey = (slug: string) => `storefront_session_${slug}`;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: la sesión dura solo mientras la página esté abierta.
  }
}

interface StorefrontUserContextType {
  user: StorefrontUser | null;
  /** Código de sesión para las llamadas del cliente (pedidos, "Mis compras"). */
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const StorefrontUserContext = createContext<StorefrontUserContextType | undefined>(undefined);

export function StorefrontUserProvider({
  children,
  slug,
}: {
  children: ReactNode;
  slug: string;
}) {
  const [user, setUser] = useState<StorefrontUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const saveSession = (data: StorefrontUser & { token?: string }) => {
    const { token: newToken, ...account } = data;
    setUser(account);
    setToken(newToken ?? null);
    writeStorage(userKey(slug), JSON.stringify(account));
    writeStorage(tokenKey(slug), newToken ?? null);
  };

  const clearSession = () => {
    setUser(null);
    setToken(null);
    writeStorage(userKey(slug), null);
    writeStorage(tokenKey(slug), null);
  };

  // Sesión guardada: solo vale si trae su código y el Worker la reconoce
  // (las de antes, sin código, se descartan para pedir ingresar de nuevo).
  useEffect(() => {
    const savedToken = readStorage(tokenKey(slug));
    const savedUser = readStorage(userKey(slug));
    if (!savedToken || !savedUser) {
      writeStorage(userKey(slug), null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    try {
      setUser(JSON.parse(savedUser));
      setToken(savedToken);
    } catch {
      clearSession();
    }
    setLoading(false);
    fetch(`${WORKER_URL}/api/storefront/me/${slug}`, { headers: { Authorization: `Bearer ${savedToken}` } })
      .then((res) => {
        if (res.status === 401) clearSession();
      })
      .catch(() => {
        // Sin conexión: se mantiene la sesión guardada.
      });
    // clearSession solo usa setters y el slug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch(`/api/storefront/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, email, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al iniciar sesión');
      }

      const data = await response.json();
      saveSession(data.user);
    } catch (err) {
      throw err;
    }
  };

  const register = async (name: string, email: string, password: string, phone?: string) => {
    try {
      const response = await fetch(`/api/storefront/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name, email, password, phone }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al registrarse');
      }

      const data = await response.json();
      saveSession(data.user);
    } catch (err) {
      throw err;
    }
  };

  const logout = () => {
    const current = token;
    clearSession();
    if (current) {
      fetch(`${WORKER_URL}/api/storefront/auth/logout/${slug}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${current}` },
      }).catch(() => {});
    }
  };

  return (
    <StorefrontUserContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </StorefrontUserContext.Provider>
  );
}

export function useStorefrontUser() {
  const context = useContext(StorefrontUserContext);
  if (!context) {
    throw new Error('useStorefrontUser debe usarse dentro de StorefrontUserProvider');
  }
  return context;
}
