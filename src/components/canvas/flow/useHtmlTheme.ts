import { useSyncExternalStore } from 'react';

/**
 * Read the app theme as React Flow expects it. The app marks the theme with
 * `data-theme` on <html> (see useTheme), but React Flow keys its palettes off
 * a `.dark` class on its own wrapper via the `colorMode` prop — the attribute
 * alone never reaches it. `useTheme` is per-component state, so a second
 * instance there would not see the toggle; subscribe to the attribute itself.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

export function useHtmlTheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
    () => 'light',
  );
}
