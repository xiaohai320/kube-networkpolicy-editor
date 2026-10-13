import { useEffect, useRef, useState, useCallback } from 'react';
import { usePolicyContext } from '@/state/context';

/**
 * The arrowhead's shape, and the offset it applies to a path's end.
 *
 * They are one thing, not two: `refX=0` puts the marker's anchor on the middle
 * of the triangle's back edge, so the head hangs *forward* of the path's end by
 * exactly ARROWHEAD_LENGTH. ARROWHEAD_OFFSET is therefore that same constant —
 * change the wedge and both change together.
 */
const ARROWHEAD_LENGTH = 13;
const ARROWHEAD_HEIGHT = 10;
const ARROWHEAD_OFFSET = ARROWHEAD_LENGTH;
const ARROWHEAD_PATH = `M 0 0 L ${ARROWHEAD_LENGTH} ${ARROWHEAD_HEIGHT / 2} L 0 ${ARROWHEAD_HEIGHT} Z`;

interface ArrowPath {
  id: string;
  d: string;
}

export function ArrowLayer() {
  const { state } = usePolicyContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<ArrowPath[]>([]);

  const recalculate = useCallback(() => {
    const overlay = containerRef.current;
    if (!overlay) return;

    // Search the parent (VisualCanvas) since rule elements are siblings, not children
    const canvas = overlay.parentElement;
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const targetEl = canvas.querySelector('[data-target-pod]');
    if (!targetEl) return;

    // The SVG's top-left is the canvas's padding-box origin, which stays put
    // when the canvas scrolls. getBoundingClientRect does not — it reports
    // viewport coordinates, so a scrolled canvas would shift every arrow by
    // the scroll amount and detach the heads from the cards.
    const scrollLeft = canvas.scrollLeft;
    const scrollTop = canvas.scrollTop;

    const targetRect = targetEl.getBoundingClientRect();
    const targetLeft = targetRect.left - canvasRect.left + scrollLeft;
    const targetRight = targetRect.right - canvasRect.left + scrollLeft;
    const targetCenterY = targetRect.top - canvasRect.top + scrollTop + targetRect.height / 2;

    const newPaths: ArrowPath[] = [];

    // Smooth horizontal bezier — control points at the horizontal midpoint
    // so the curve gently bows left/right without vertical swooping. The end
    // tangent is horizontal, which is why the head can be offset by a plain
    // delta-x and still land on the card edge.
    const bezier = (sx: number, sy: number, ex: number, ey: number) => {
      const midX = (sx + ex) / 2;
      return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ey}, ${ex} ${ey}`;
    };

    // Ingress arrows: sub-rule row right edge -> target left edge
    const ingressEls = canvas.querySelectorAll('[data-direction="ingress"]');
    ingressEls.forEach(el => {
      const elRect = el.getBoundingClientRect();
      const startX = elRect.right - canvasRect.left + scrollLeft;
      const startY = elRect.top - canvasRect.top + scrollTop + elRect.height / 2;
      const endX = targetLeft - ARROWHEAD_OFFSET;
      const endY = targetCenterY;

      const d = bezier(startX, startY, endX, endY);
      const ruleId = el.getAttribute('data-rule-id') ?? '';
      newPaths.push({ id: `ingress-${ruleId}`, d });
    });

    // Egress arrows: target right edge -> sub-rule row left edge
    const egressEls = canvas.querySelectorAll('[data-direction="egress"]');
    egressEls.forEach(el => {
      const elRect = el.getBoundingClientRect();
      const startX = targetRight;
      const startY = targetCenterY;
      const endX = elRect.left - canvasRect.left + scrollLeft - ARROWHEAD_OFFSET;
      const endY = elRect.top - canvasRect.top + scrollTop + elRect.height / 2;

      const d = bezier(startX, startY, endX, endY);
      const ruleId = el.getAttribute('data-rule-id') ?? '';
      newPaths.push({ id: `egress-${ruleId}`, d });
    });

    setPaths(newPaths);
  }, []);

  // Recalculate on state changes
  useEffect(() => {
    const timer = setTimeout(recalculate, 50);
    return () => clearTimeout(timer);
  }, [state.policy, recalculate]);

  // Recalculate on resize via ResizeObserver
  useEffect(() => {
    const overlay = containerRef.current;
    const canvas = overlay?.parentElement;
    if (!canvas) return;
    const observer = new ResizeObserver(() => recalculate());
    observer.observe(canvas);
    window.addEventListener('resize', recalculate);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', recalculate);
    };
  }, [recalculate]);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/*
           * One arrowhead, in the allow colour, because arrows are always allow
           * rules. If deny-coloured arrows ever come back they need their own
           * marker — a marker cannot inherit the path's stroke.
           *
           * `markerUnits="userSpaceOnUse"` makes markerWidth/Height literal
           * pixels, so the wedge stays ARROWHEAD_LENGTH wide regardless of
           * stroke. `refX=0` anchors the marker at the middle of the back edge
           * rather than at the tip, so the stroke meets the wedge at its
           * centre; see ARROWHEAD_OFFSET above.
           */}
          <marker
            id="arrow-head"
            viewBox={`0 0 ${ARROWHEAD_LENGTH} ${ARROWHEAD_HEIGHT}`}
            refX="0"
            refY={String(ARROWHEAD_HEIGHT / 2)}
            markerWidth={ARROWHEAD_LENGTH}
            markerHeight={ARROWHEAD_HEIGHT}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d={ARROWHEAD_PATH} fill="var(--color-arrow-allow)" />
          </marker>
        </defs>
        {/*
         * Every rule card is an *allow* rule, so every arrow is the allow colour.
         * Colour is never read as direction — that comes from which column the
         * card sits in. Red (`--color-arrow-deny`) is reserved for a direction
         * that denies everything, which only the target pod's badge shows.
         * `orient="auto"` on the marker turns the arrowhead toward where the
         * path is heading, so both columns read as flowing toward their target.
         */}
        {paths.map(p => (
          <path
            key={p.id}
            d={p.d}
            fill="none"
            stroke="var(--color-arrow-allow)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#arrow-head)"
          />
        ))}
      </svg>
    </div>
  );
}
