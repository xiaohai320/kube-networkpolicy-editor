import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface YamlDisplayProps {
  yaml: string;
  /** 1-based inclusive line ranges to highlight, by canvas rule id. */
  ruleMap?: Record<string, [number, number]>;
  onYamlChange?: (yaml: string) => void;
}

export function YamlDisplay({ yaml, ruleMap, onYamlChange }: YamlDisplayProps) {
  const [localYaml, setLocalYaml] = useState(yaml);
  const isUserEditing = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);

  // Sync from props when user is NOT editing
  useEffect(() => {
    if (!isUserEditing.current) {
      setLocalYaml(yaml);
    }
  }, [yaml]);

  const lineCount = useMemo(() => localYaml.split('\n').length, [localYaml]);

  // Highlight rectangles live behind the textarea: the textarea paints itself
  // transparent so the ranges show through. The textarea never wraps
  // (overflow-auto), so line indices stay aligned with the underlay.
  const highlightLines = useMemo(() => {
    if (!ruleMap) return [];
    return Object.values(ruleMap);
  }, [ruleMap]);

  const inHighlight = useCallback(
    (line: number) => highlightLines.some(([from, to]) => line >= from && line <= to),
    [highlightLines],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      isUserEditing.current = true;
      setLocalYaml(value);

      // Debounce parse-back
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        isUserEditing.current = false;
        onYamlChange?.(value);
      }, 500);
    },
    [onYamlChange],
  );

  const handleBlur = useCallback(() => {
    // Flush any pending debounce
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = undefined;
    }
    if (isUserEditing.current) {
      isUserEditing.current = false;
      onYamlChange?.(localYaml);
    }
  }, [onYamlChange, localYaml]);

  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      const { scrollTop } = textareaRef.current;
      if (lineNumRef.current) lineNumRef.current.scrollTop = scrollTop;
      if (underlayRef.current) {
        underlayRef.current.style.transform = `translateY(-${scrollTop}px)`;
      }
    }
  }, []);

  // Center the highlighted rule block in the viewport when it changes.
  // Line height is leading-5 (1.25rem = 20px): first line's top minus half
  // the visible height puts the middle of the block at the middle of the pane.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ruleMap || !ta) return;
    const ranges = Object.values(ruleMap);
    if (ranges.length === 0) return;
    const first = Math.min(...ranges.map(([from]) => from));
    const last = Math.max(...ranges.map(([, to]) => to));
    const LINE_H = 20;
    const target = (first - 1) * LINE_H - (ta.clientHeight - (last - first + 1) * LINE_H) / 2;
    ta.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [ruleMap]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return (
    <div className="flex overflow-hidden h-full font-mono text-sm">
      {/* Line numbers */}
      <div
        ref={lineNumRef}
        className="select-none text-right pr-3 pl-3 py-2 text-yaml-line-num border-r border-divider shrink-0 overflow-hidden"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className={`leading-5 ${inHighlight(i + 1) ? 'bg-arrow-allow/15' : ''}`}>
            {i + 1}
          </div>
        ))}
      </div>
      {/* Editable YAML over a highlight underlay */}
      <div className="flex-1 relative min-w-0">
        <div
          ref={underlayRef}
          aria-hidden
          className="absolute inset-0 py-2 pl-4 pr-4 leading-5 pointer-events-none overflow-hidden will-change-transform"
        >
          {highlightLines.map(([from, to], i) => (
            <div
              key={i}
              className="absolute left-0 right-0 bg-arrow-allow/15 border-l-2 border-arrow-allow"
              style={{
                top: `calc(0.5rem + ${(from - 1) * 1.25}rem)`,
                height: (to - from + 1) * 1.25 + 'rem',
              }}
            />
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={localYaml}
          onChange={handleChange}
          onBlur={handleBlur}
          onScroll={handleScroll}
          spellCheck={false}
          className="absolute inset-0 py-2 pl-4 pr-4 text-yaml-text bg-transparent resize-none outline-none leading-5 overflow-auto"
        />
      </div>
    </div>
  );
}
