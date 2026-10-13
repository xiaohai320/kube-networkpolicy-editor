import { Languages } from 'lucide-react';
import { useTranslation } from './index';
import { BTN_TOOLBAR } from '../components/ui/button';

/**
 * English ⇄ 中文 switch, sitting next to the theme toggle. The choice only
 * lasts for this session: `detectLocale` reads `localStorage['netpol-lang']` at
 * startup, but nothing writes it, so the browser's own language wins next time.
 * Persisting it lands with the workspace store.
 */
export function LocaleToggle() {
  const { i18n, t } = useTranslation();

  const isZh = i18n.language === 'zh';

  // `<html lang>` is updated by `initI18n`'s `languageChanged` listener.
  const toggle = () => {
    void i18n.changeLanguage(isZh ? 'en' : 'zh');
  };

  // The icon carries no text, and `title` is not an accessible name.
  const label = t(isZh ? 'action-locale-en' : 'action-locale-zh');

  return (
    <button
      onClick={toggle}
      className={BTN_TOOLBAR}
      title={label}
      aria-label={label}
    >
      <Languages size={18} />
    </button>
  );
}
