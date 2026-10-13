import { useState, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

/**
 * Versioned rather than `netpol-theme`, so a preference saved under the old key
 * cannot pin the app to the look it had before: that value was written on every
 * render and was almost always 'dark'. The light palette is now the default, so
 * a stale dark choice would otherwise hide it. Toggling writes the new key.
 */
const STORAGE_KEY = 'netpol-theme.v2';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme } as const;
}
