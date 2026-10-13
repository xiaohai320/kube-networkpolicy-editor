import { useCallback, useEffect, useRef, useState } from 'react';
import { PolicyProvider } from '@/state/context';
import { VisualCanvas } from '@/components/canvas/VisualCanvas';
import { DraggableDivider } from '@/components/ui/DraggableDivider';
import { YamlPanel } from '@/components/yaml/YamlPanel';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LocaleToggle } from '@/i18n/LocaleToggle';
import { PolicyPageBar, type PolicyPage } from '@/components/ui/PolicyPageBar';
import { ClusterPanel } from '@/components/cluster/ClusterPanel';
import type { EditorState, ClusterSync } from '@/state/actions';
import { Cloud, X, Users, LogOut } from 'lucide-react';
import { fetchMe, logout, type AuthMe } from '@/lib/auth-api';
import { LoginPage } from '@/components/auth/LoginPage';
import { UserAdminPanel } from '@/components/auth/UserAdminPanel';
import { useTranslation } from '@/i18n';
import { initialState } from '@/state/reducer';
import { BTN_TOOLBAR_TEXT } from '@/components/ui/button';
import { createDefaultPolicy } from '@/types/policy';
import { detectAndParse } from '@/lib/yaml-parser';
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

/**
 * Load a cluster policy as a new page: parse + validate first, then append the
 * page and make it active. The cluster marker rides on the initial state so
 * the page starts as `unsynced` relative to the cluster.
 */
function clusterLoadedPage(yaml: string, label: string): PageData | undefined {
  const { policy, format } = detectAndParse(yaml);
  if (!policy) return undefined;
  return {
    page: { id: generateId(), label },
    state: {
      policy: { ...policy, format },
      activeSpec: 0,
      clusterSync: 'unsynced',
    },
  };
}

function App() {
  const [splitPercent, setSplitPercent] = useState(60);
  const [clusterOpen, setClusterOpen] = useState(false);
  const [authState, setAuthState] = useState<AuthMe | 'checking' | null>('checking');
  const [userAdminOpen, setUserAdminOpen] = useState(false);
  const [pages, setPages] = useState<PageData[]>(() => [createPage('Policy 1')]);
  const [activeId, setActiveId] = useState<string>(() => pages[0]!.page.id);
  const stateRef = useRef<Record<string, EditorState>>({});

  // `pages` is never empty: handleRemovePage keeps at least one entry.
  const activePage = pages.find(p => p.page.id === activeId) ?? pages[0]!;
  const { t } = useTranslation();

  // Session probe: 'checking' holds the editor until answered, so a logged-out
  // visitor never sees the policy UI flash before the gate. The effect keys on
  // the checking state itself — after a successful login the gate sets
  // 'checking' again, which must re-run this probe, not just spin forever.
  useEffect(() => {
    if (authState !== 'checking') return;
    let live = true;
    fetchMe()
      .then(me => live && setAuthState(me))
      .catch(() => live && setAuthState({ authenticated: false }));
    return () => {
      live = false;
    };
  }, [authState]);

  const handleLogout = useCallback(async () => {
    await logout();
    setAuthState({ authenticated: false });
  }, []);

  const handleStateChange = useCallback(
    (state: EditorState) => {
      stateRef.current[activeId] = state;
      // Mirror into pages[] immediately, not just on switch: the cluster-sync
      // badge in the header reads the active page's snapshot, and apply/edit
      // transitions must be visible without a page round-trip.
      setPages(prev =>
        prev.map(p => (p.page.id === activeId ? { ...p, state } : p)),
      );
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
      // One synchronous decision off the current snapshot: the previous
      // two-`setPages` version re-ran the filter on an already-filtered list,
      // got index -1, and dereferenced `remaining[-1]` — a TypeError in the
      // state updater that blanked the page whenever the active tab closed.
      const idx = pages.findIndex(p => p.page.id === id);
      if (idx === -1) return;
      const remaining = pages.filter(p => p.page.id !== id);
      if (remaining.length === 0) return;
      setPages(remaining);
      if (activeId === id) {
        setActiveId(remaining[Math.min(idx, remaining.length - 1)]!.page.id);
      }
    },
    [pages, activeId],
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

  const handleLoadFromCluster = useCallback(
    (yaml: string, label: string) => {
      const page = clusterLoadedPage(yaml, label);
      if (!page) return;
      setPages(prev => [
        ...prev.map(p =>
          p.page.id === activeId && stateRef.current[activeId]
            ? { ...p, state: stateRef.current[activeId]! }
            : p,
        ),
        page,
      ]);
      setActiveId(page.page.id);
    },
    [activeId],
  );

  if (authState === 'checking' || authState === null || !authState.authenticated) {
    return <LoginPage onLoggedIn={() => setAuthState('checking')} />;
  }

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
          <button
            className={BTN_TOOLBAR_TEXT}
            onClick={() => setClusterOpen(o => !o)}
            aria-label={t('cluster-panel-title')}
          >
            <Cloud size={14} />
            {clusterOpen && <X size={14} />}
          </button>
          {authState.role === 'admin' && (
            <button
              className={BTN_TOOLBAR_TEXT}
              onClick={() => setUserAdminOpen(true)}
              aria-label={t('auth-users-title')}
              title={t('auth-users-title')}
            >
              <Users size={14} />
            </button>
          )}
          <button
            className={BTN_TOOLBAR_TEXT}
            onClick={() => void handleLogout()}
            aria-label={t('auth-logout')}
            title={`${authState.user ?? ''} · ${t('auth-logout')}`}
          >
            <LogOut size={14} />
          </button>
          <ClusterSyncBadge sync={activePage.state.clusterSync ?? 'local'} />
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* Main content: cluster panel pushes (not covers) the editor area */}
      <div className="flex flex-1 min-h-0">
        {clusterOpen && (
          <ClusterPanel onLoadPolicy={handleLoadFromCluster} onClose={() => setClusterOpen(false)} />
        )}
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
      {userAdminOpen && <UserAdminPanel onClose={() => setUserAdminOpen(false)} />}
    </div>
  );
}

/** Header badge for the active page's cluster relationship (i18n-titled). */
function ClusterSyncBadge({ sync }: { sync: ClusterSync }) {
  const { t } = useTranslation();
  if (sync === 'local') return null;
  const cls = sync === 'applied' ? 'text-green-300' : 'text-orange-300';
  const glyph = sync === 'applied' ? '✓' : '●';
  const title = sync === 'applied' ? t('cluster-synced') : t('cluster-unsynced');
  return (
    <span className={`text-xs px-1.5 ${cls}`} title={title}>
      {glyph}
    </span>
  );
}

export default App;
