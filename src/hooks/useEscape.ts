import { useEffect } from 'react';

/**
 * Close on Escape. Modal components render themselves into a portal-free
 * `fixed` overlay, so a plain document listener is enough — there is no nested
 * dialog stacking to worry about.
 */
export function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape]);
}
