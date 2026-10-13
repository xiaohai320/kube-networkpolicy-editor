import { useCallback, useRef } from 'react';
import { GripHorizontal } from 'lucide-react';

interface DraggableDividerProps {
  onResize: (topPercent: number) => void;
}

export function DraggableDivider({ onResize }: DraggableDividerProps) {
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const percent = (ev.clientY / window.innerHeight) * 100;
        const clamped = Math.min(80, Math.max(20, percent));
        onResize(clamped);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [onResize],
  );

  return (
    <div
      className="h-2 bg-card-border cursor-row-resize shrink-0 flex items-center justify-center hover:bg-surface transition-colors"
      onMouseDown={handleMouseDown}
    >
      <GripHorizontal size={14} className="text-text-secondary" />
    </div>
  );
}
