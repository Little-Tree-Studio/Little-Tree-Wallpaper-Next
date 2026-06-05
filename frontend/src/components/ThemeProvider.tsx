import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSetting, setSetting } from '@/api/backend';

type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolve(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function apply(theme: ThemeMode) {
  const resolved = resolve(theme);
  const html = document.documentElement;
  if (resolved === 'dark') {
    html.classList.add('dark');
    html.setAttribute('data-theme', 'dark');
  } else {
    html.classList.remove('dark');
    html.setAttribute('data-theme', 'light');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolve('system'));
  const [loaded, setLoaded] = useState(false);

  const applyAndResolve = useCallback((next: ThemeMode) => {
    apply(next);
    setResolvedTheme(resolve(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSetting('ui.theme')
      .then((value) => {
        if (cancelled) return;
        const next: ThemeMode = value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
        setThemeState(next);
        applyAndResolve(next);
      })
      .catch(() => {
        applyAndResolve('system');
      })
      .finally(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [applyAndResolve]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyAndResolve(theme);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, applyAndResolve]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyAndResolve(next);
    setSetting('ui.theme', next).catch(() => {});
  }, [applyAndResolve]);

  if (!loaded) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}
