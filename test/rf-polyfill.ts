import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * React Flow polyfills for happy-dom, which ships its own stubs that don't
 * behave like a browser: its ResizeObserver never fires, and its
 * DOMMatrixReadOnly can't parse a transform string ("translate(0px,0px)
 * scale(1)") — RF divides by matrix.m22, so a broken parse yields zoom 0 and
 * every edge is dropped. Both are overwritten here, on globalThis AND the
 * happy-dom window object (RF reads them off `window`).
 */

class FakeResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
  }
  observe = (el: Element) => {
    // Fire synchronously with the element's (faked) rect so RF's node
    // measuring and handle-bounds update run without a real layout pass.
    const rect = el.getBoundingClientRect();
    this.callback(
      [
        {
          target: el,
          contentRect: rect as DOMRectReadOnly,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
}

class FakeDOMMatrixReadOnly {
  m21 = 0;
  m22 = 1;
  constructor(transform?: string) {
    // Only scale matters to RF (zoom = m22); parse "scale(N)" out of the
    // transform string.
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    if (scale) {
      this.m21 = Number(scale);
      this.m22 = Number(scale);
    }
  }
}

for (const target of [globalThis, window as unknown as Record<string, unknown>]) {
  (target as Record<string, unknown>).ResizeObserver = FakeResizeObserver;
  (target as Record<string, unknown>).DOMMatrixReadOnly = FakeDOMMatrixReadOnly;
}

// Non-zero geometry so RF's edge router has real coordinates to work with.
// RF's node measuring path reads offsetWidth/offsetHeight (getDimensions),
// and handle bounds come from getBoundingClientRect deltas — both must be
// non-zero or updateNodeInternals bails and edges never render.
const measure = (el: Element): { width: number; height: number } => ({
  width: Number(el.getAttribute?.('data-test-width') ?? 260),
  height: Number(el.getAttribute?.('data-test-height') ?? 120),
});

HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
  const { width, height } = measure(this);
  return {
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: height,
    width, height,
    toJSON: () => ({}),
  } as DOMRect;
};

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return measure(this).width;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return measure(this).height;
  },
});
