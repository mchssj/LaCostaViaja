'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, hasSession, onSessionExpired, type OperatorProfile } from './api';

interface SessionValue {
  user: OperatorProfile | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: OperatorProfile) => void;
}

const Ctx = createContext<SessionValue | null>(null);

const PUBLIC_PATHS = ['/login'];
const SETUP_PATH = '/cuenta';

/**
 * Sesión del panel: perfil con permisos (de /auth/me). Redirige a /login sin sesión y a /cuenta si
 * falta completar la configuración (contraseña temporal o segundo factor obligatorio).
 * Ocultar opciones del menú es comodidad: quien decide es la API.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<OperatorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!hasSession()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<{ user: OperatorProfile }>('/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return onSessionExpired(() => {
      setUser(null);
      router.replace('/login?expired=1');
    });
  }, [refresh, router]);

  useEffect(() => {
    if (loading) return;
    if (!user && !PUBLIC_PATHS.includes(pathname)) router.replace('/login');
    else if (user && user.setupRequired.length > 0 && pathname !== SETUP_PATH) router.replace(SETUP_PATH);
  }, [loading, user, pathname, router]);

  const value: SessionValue = {
    user,
    loading,
    can: (p) => !!user && user.setupRequired.length === 0 && user.permissions.includes(p),
    refresh,
    logout: async () => {
      await api.logout();
      setUser(null);
      router.replace('/login');
    },
    setUser,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fuera de SessionProvider');
  return v;
}
