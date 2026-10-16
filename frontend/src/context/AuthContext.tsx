"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "@/services/api";
import type { AuthResponse, User } from "@/services/api";

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  google: (credential: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (api.getToken()) {
      api.fetchMe().then(setUser).catch(() => api.setToken(null)).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    const onLogout = () => setUser(null);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  const accept = useCallback((res: AuthResponse) => {
    api.setToken(res.access_token);
    setUser(res.user);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      user,
      loading,
      login: async (e, p) => accept(await api.login(e, p)),
      signup: async (e, p, n) => accept(await api.signup(e, p, n)),
      google: async (c) => accept(await api.googleLogin(c)),
      logout: () => {
        api.setToken(null);
        setUser(null);
      },
    }),
    [user, loading, accept],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
