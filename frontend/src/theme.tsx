import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

const storageKey = "bothybound-theme";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* private mode or blocked storage */
  }
  return "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    /* keep the in-memory choice if storage is unavailable */
  }
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme(next) {
        setThemeState(next);
        applyTheme(next);
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
