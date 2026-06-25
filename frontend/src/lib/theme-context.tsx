"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
  ReactNode,
  useMemo,
} from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  theme: ThemeMode | undefined;
  resolvedTheme: ResolvedTheme | undefined;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  isMounted: boolean;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// --- Reducer ---

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme | undefined;
  isMounted: boolean;
  isLoading: boolean;
  error: string | null;
}

type ThemeAction =
  | { type: "MOUNT"; theme: ThemeMode; resolvedTheme: ResolvedTheme }
  | { type: "SET_THEME"; theme: ThemeMode; resolvedTheme: ResolvedTheme }
  | { type: "SET_RESOLVED"; resolvedTheme: ResolvedTheme }
  | { type: "SET_ERROR"; error: string; theme: ThemeMode; resolvedTheme: ResolvedTheme | undefined }
  | { type: "CLEAR_ERROR" };

function themeReducer(state: ThemeState, action: ThemeAction): ThemeState {
  switch (action.type) {
    case "MOUNT":
      return {
        ...state,
        isMounted: true,
        isLoading: false,
        theme: action.theme,
        resolvedTheme: action.resolvedTheme,
      };
    case "SET_THEME":
      return {
        ...state,
        theme: action.theme,
        resolvedTheme: action.resolvedTheme,
        error: null,
      };
    case "SET_RESOLVED":
      return { ...state, resolvedTheme: action.resolvedTheme };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
        theme: action.theme,
        resolvedTheme: action.resolvedTheme,
      };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

// --- Provider ---

interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: ThemeMode;
  readonly storageKey?: string;
  readonly enableSystem?: boolean;
  readonly forcedTheme?: ResolvedTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "merchant-theme-preference",
  enableSystem = true,
  forcedTheme,
}: ThemeProviderProps) {
  const [state, dispatch] = useReducer(themeReducer, {
    theme: defaultTheme,
    resolvedTheme: undefined,
    isMounted: false,
    isLoading: true,
    error: null,
  });

  // Ref so media query listener always reads the latest theme without stale closure
  const themeRef = useRef<ThemeMode>(defaultTheme);
  themeRef.current = state.theme;

  const resolveTheme = useCallback(
    (themeMode: ThemeMode): ResolvedTheme => {
      if (forcedTheme) return forcedTheme;
      if (themeMode !== "system") return themeMode;
      const prefersDark =
        typeof globalThis !== "undefined" && globalThis.window
          ? globalThis.window.matchMedia("(prefers-color-scheme: dark)").matches
          : false;
      return prefersDark ? "dark" : "light";
    },
    [forcedTheme]
  );

  const applyThemeToDom = useCallback((resolved: ResolvedTheme) => {
    if (typeof globalThis === "undefined" || !globalThis.document) return;
    globalThis.document.documentElement.classList.remove("light", "dark");
    globalThis.document.documentElement.classList.add(resolved);
    const meta = globalThis.document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolved === "dark" ? "#0A0A0A" : "#FFFFFF");
    }
  }, []);

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      const previousTheme = themeRef.current;
      const previousResolved = state.resolvedTheme;

      try {
        const resolved = resolveTheme(newTheme);
        if (typeof globalThis !== "undefined" && globalThis.localStorage) {
          globalThis.localStorage.setItem(storageKey, newTheme);
        }
        applyThemeToDom(resolved);
        dispatch({ type: "SET_THEME", theme: newTheme, resolvedTheme: resolved });
      } catch (err) {
        applyThemeToDom(previousResolved ?? resolveTheme(previousTheme));
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Failed to set theme",
          theme: previousTheme,
          resolvedTheme: previousResolved,
        });
        console.error("Theme setting error:", err);
      }
    },
    [storageKey, state.resolvedTheme, resolveTheme, applyThemeToDom]
  );

  const toggleTheme = useCallback(() => {
    const themes: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = themes.indexOf(themeRef.current);
    const next = themes[(currentIndex + 1) % themes.length];
    setTheme(next);
  }, [setTheme]);

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  // Mount effect — runs once to read stored preference and attach system listener
  useEffect(() => {
    const stored =
      typeof globalThis !== "undefined" && globalThis.localStorage
        ? (globalThis.localStorage.getItem(storageKey) as ThemeMode | null)
        : null;
    const initialTheme = stored || defaultTheme;
    const resolved = resolveTheme(initialTheme);

    applyThemeToDom(resolved);
    dispatch({ type: "MOUNT", theme: initialTheme, resolvedTheme: resolved });

    if (!enableSystem || forcedTheme) return;

    const mediaQuery = globalThis.window?.matchMedia("(prefers-color-scheme: dark)");
    if (!mediaQuery) return;

    const handleSystemChange = () => {
      // Only re-resolve when current theme is system
      if (themeRef.current === "system") {
        const newResolved: ResolvedTheme = mediaQuery.matches ? "dark" : "light";
        applyThemeToDom(newResolved);
        dispatch({ type: "SET_RESOLVED", resolvedTheme: newResolved });
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — runs once on mount

  const value: ThemeContextType = useMemo(
    () => ({
      theme: state.theme,
      resolvedTheme: state.resolvedTheme,
      setTheme,
      toggleTheme,
      isMounted: state.isMounted,
      isLoading: state.isLoading,
      error: state.error,
      clearError,
    }),
    [state, setTheme, toggleTheme, clearError]
  );

  return (
    <ThemeContext.Provider value={value}>
      <NextThemesProvider
        attribute="class"
        defaultTheme={defaultTheme}
        enableSystem={enableSystem}
        storageKey={storageKey}
        forcedTheme={forcedTheme}
      >
        {children}
      </NextThemesProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function useThemeState() {
  const { theme, resolvedTheme, isMounted, isLoading, error } = useTheme();
  return {
    theme,
    resolvedTheme,
    isMounted,
    isLoading,
    error,
    isDark: resolvedTheme === "dark",
    isLight: resolvedTheme === "light",
    isSystem: theme === "system",
  };
}

export function useThemeActions() {
  const { setTheme, toggleTheme, clearError } = useTheme();
  return { setTheme, toggleTheme, clearError };
}
