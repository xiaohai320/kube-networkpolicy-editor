import { IngressColumn } from './IngressColumn';
import { TargetPodNode } from './TargetPodNode';
import { EgressColumn } from './EgressColumn';
import { ArrowLayer } from './ArrowLayer';

export function VisualCanvas() {
  return (
    <div className="relative flex items-center justify-center gap-12 p-6 h-full overflow-auto min-h-0">
      <ArrowLayer />
      <IngressColumn />

      <div className="flex flex-col items-center shrink-0">
        <TargetPodNode />
      </div>

      <EgressColumn />
    </div>
  );
}
