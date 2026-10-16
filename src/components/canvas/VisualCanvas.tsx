import { FlowCanvas } from './flow/FlowCanvas';

/**
 * Thin shell kept so App.tsx's reference (and the tests that mount
 * VisualCanvas) stay stable; the flow graph itself lives in flow/FlowCanvas.
 */
export function VisualCanvas() {
  return <FlowCanvas />;
}
