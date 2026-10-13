import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/i18n';
import { BTN_TOOLBAR } from './button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  // `title` alone is not an accessible name for a `<button>`, so repeat it
  // in `aria-label` for screen readers.
  const label = t('theme-switch', { mode: t(theme === 'dark' ? 'theme-light' : 'theme-dark') });

  return (
    <button
      onClick={toggleTheme}
      className={BTN_TOOLBAR}
      title={label}
      aria-label={label}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
