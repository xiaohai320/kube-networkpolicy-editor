import { useCallback, useRef, useState } from 'react';
import { PolicyProvider } from '@/state/context';
import { VisualCanvas } from '@/components/canvas/VisualCanvas';
import { DraggableDivider } from '@/components/ui/DraggableDivider';
import { YamlPanel } from '@/components/yaml/YamlPanel';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LocaleToggle } from '@/i18n/LocaleToggle';
import { PolicyPageBar, type PolicyPage } from '@/components/ui/PolicyPageBar';
import type { EditorState } from '@/state/actions';
import { initialState } from '@/state/reducer';
import { createDefaultPolicy } from '@/types/policy';
import { generateId } from '@/lib/utils';

interface PageData {
  page: PolicyPage;
  state: EditorState;
}

function createPage(label: string): PageData {
  const name = label.toLowerCase().replace(/\s+/g, '-');
  return {
    page: { id: generateId(), label },
    state: { policy: createDefaultPolicy({ name }), activeSpec: 0 },
  };
}

function App() {
  const [splitPercent, setSplitPercent] = useState(60);
  const [pages, setPages] = useState<PageData[]>(() => [createPage('Policy 1')]);
  const [activeId, setActiveId] = useState<string>(() => pages[0]!.page.id);
  const stateRef = useRef<Record<string, EditorState>>({});

  // `pages` is never empty: handleRemovePage keeps at least one entry.
  const activePage = pages.find(p => p.page.id === activeId) ?? pages[0]!;

  const handleStateChange = useCallback(
    (state: EditorState) => {
      stateRef.current[activeId] = state;
    },
    [activeId],
  );

  const handleAddPage = useCallback(() => {
    const newPage = createPage(`Policy ${pages.length + 1}`);
    // Snapshot the active page before switching so its edits survive the remount.
    setPages(prev => [
      ...prev.map(p =>
        p.page.id === activeId && stateRef.current[activeId]
          ? { ...p, state: stateRef.current[activeId] }
          : p,
      ),
      newPage,
    ]);
    setActiveId(newPage.page.id);
  }, [pages.length, activeId]);

  const handleRemovePage = useCallback(
    (id: string) => {
      setPages(prev => {
        const filtered = prev.filter(p => p.page.id !== id);
        return filtered.length > 0 ? filtered : prev;
      });
      if (activeId === id) {
        setPages(prev => {
          const idx = prev.findIndex(p => p.page.id === id);
          const remaining = prev.filter(p => p.page.id !== id);
          if (remaining.length > 0) {
            // `remaining` is non-empty, so this index is always in range.
            setActiveId(remaining[Math.min(idx, remaining.length - 1)]!.page.id);
          }
          return remaining.length > 0 ? remaining : prev;
        });
      }
    },
    [activeId],
  );

  const handleSelectPage = useCallback(
    (id: string) => {
      // Snapshot the active page before switching so its edits survive the remount.
      setPages(prev =>
        prev.map(p =>
          p.page.id === activeId && stateRef.current[activeId]
            ? { ...p, state: stateRef.current[activeId] }
            : p,
        ),
      );
      setActiveId(id);
    },
    [activeId],
  );

  const handleRenamePage = useCallback((id: string, label: string) => {
    setPages(prev => prev.map(p => (p.page.id === id ? { ...p, page: { ...p.page, label } } : p)));
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Page tabs */}
      <div className="flex items-center justify-between bg-surface border-b border-divider">
        <PolicyPageBar
          pages={pages.map(p => p.page)}
          activeId={activeId}
          onSelect={handleSelectPage}
          onAdd={handleAddPage}
          onRemove={handleRemovePage}
          onRename={handleRenamePage}
        />
        <div className="flex items-center gap-1 pr-2">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* Main content — keyed by active page to force remount */}
      <PolicyProvider
        key={activeId}
        initial={activePage.state ?? initialState}
        onStateChange={handleStateChange}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Visual Canvas */}
          <div
            className="bg-canvas overflow-auto relative"
            style={{ height: `${splitPercent}%` }}
          >
            <VisualCanvas />
          </div>

          {/* Draggable Divider */}
          <DraggableDivider onResize={setSplitPercent} />

          {/* YAML Panel */}
          <div
            className="bg-yaml-bg overflow-auto"
            style={{ height: `${100 - splitPercent}%` }}
          >
            <YamlPanel />
          </div>
        </div>
      </PolicyProvider>
    </div>
  );
}

export default App;
