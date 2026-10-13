import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface YamlDisplayProps {
  yaml: string;
  onYamlChange?: (yaml: string) => void;
}

export function YamlDisplay({ yaml, onYamlChange }: YamlDisplayProps) {
  const [localYaml, setLocalYaml] = useState(yaml);
  const isUserEditing = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync from props when user is NOT editing
  useEffect(() => {
    if (!isUserEditing.current) {
      setLocalYaml(yaml);
    }
  }, [yaml]);

  const lineCount = useMemo(() => localYaml.split('\n').length, [localYaml]);

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
    if (lineNumRef.current && textareaRef.current) {
      lineNumRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

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
          <div key={i} className="leading-5">
            {i + 1}
          </div>
        ))}
      </div>
      {/* Editable YAML */}
      <textarea
        ref={textareaRef}
        value={localYaml}
        onChange={handleChange}
        onBlur={handleBlur}
        onScroll={handleScroll}
        spellCheck={false}
        className="flex-1 py-2 pl-4 pr-4 text-yaml-text bg-transparent resize-none outline-none leading-5 overflow-auto"
      />
    </div>
  );
}
