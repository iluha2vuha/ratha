import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentUser, loginAccount, logoutAccount, registerAccount, type AuthUser } from "./api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: typeof loginAccount;
  register: typeof registerAccount;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((current) => { if (active) setUser(current); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async login(input) {
      const next = await loginAccount(input);
      setUser(next);
      return next;
    },
    async register(input) {
      const next = await registerAccount(input);
      setUser(next);
      return next;
    },
    async logout() {
      await logoutAccount();
      setUser(null);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
