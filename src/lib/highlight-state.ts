import { useSyncExternalStore } from 'react';

/**
 * Hovered canvas rule → YAML highlight, kept in a module store rather than
 * React context: hover churns at pointer speed, and routing it through the
 * policy context would re-render the whole editor per pixel of movement.
 */

let hoveredRuleId: string | null = null;
const listeners = new Set<() => void>();

export function setHoveredRule(id: string | null): void {
  if (id === hoveredRuleId) return;
  hoveredRuleId = id;
  for (const l of listeners) l();
}

export function useHoveredRule(): string | null {
  return useSyncExternalStore(
    onChange => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => hoveredRuleId,
  );
}
