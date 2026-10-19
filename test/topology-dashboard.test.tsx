/**
 * Topology dashboard mount-smoke: the components consume the (exhaustively
 * unit-tested) engine, so these tests assert the WIRING — graph reaches the
 * canvas, the drawer opens with the right policies, empty state renders —
 * not the engine math. Prior art: canvas.test.tsx asserts data, not paths.
 */

// @vitest-environment happy-dom

import './rf-polyfill';
import { describe, expect, it, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopologyDashboard } from '@/components/topology/TopologyDashboard';
import type { EngineSelector, PolicyRef, PodInfo } from '@/components/topology/topology-engine';
import { initI18n } from '@/i18n';

// The dashboard's data seam: both fetch paths stubbed so tests drive the
// engine through its REAL consumer without any /k8s plumbing.
vi.mock('@/components/topology/topology-data', () => ({
  fetchTopologyData: vi.fn(),
  fetchNamespaceLabels: vi.fn(),
  listAllNamespaces: vi.fn(),
}));

vi.mock('@/lib/cluster-api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cluster-api')>();
  return {
    ...actual,
    listClusterPolicies: vi.fn(),
    getClusterPolicyYaml: vi.fn(),
  };
});

import { listClusterPolicies, getClusterPolicyYaml } from '@/lib/cluster-api';
import { fetchTopologyData, fetchNamespaceLabels, listAllNamespaces } from '@/components/topology/topology-data';

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  cleanup();
});

const PODS: PodInfo[] = [
  { name: 'web-1', labels: { app: 'web' }, ready: true, workload: 'web' },
  { name: 'db-1', labels: { app: 'db' }, ready: true, workload: 'db' },
];

const POLICIES: PolicyRef[] = [
  {
    kind: 'NetworkPolicy',
    namespace: 'app',
    name: 'web-to-db',
    specs: [{
      endpointSelector: { matchLabels: { app: 'web' } },
      ingress: [],
      egress: [
        { target: { kind: 'workload' }, podSelector: { matchLabels: { app: 'db' } }, ports: '5432/TCP' },
      ],
      enforcedIngress: true,
      enforcedEgress: true,
    }],
  },
];

describe('TopologyDashboard', () => {
  beforeEach(() => {
    vi.mocked(fetchNamespaceLabels).mockResolvedValue({});
    vi.mocked(listAllNamespaces).mockResolvedValue(['app', 'other']);
    vi.mocked(listClusterPolicies).mockResolvedValue([
      { kind: 'NetworkPolicy', namespace: 'app', name: 'web-to-db' },
      { kind: 'NetworkPolicy', namespace: 'other', name: 'x' },
    ]);
    vi.mocked(getClusterPolicyYaml).mockResolvedValue('kind: NetworkPolicy\n');
    vi.mocked(fetchTopologyData).mockResolvedValue({
      pods: PODS,
      policies: POLICIES,
      workloads: [
        { name: 'web', selector: { matchLabels: { app: 'web' } } satisfies EngineSelector },
        { name: 'db', selector: { matchLabels: { app: 'db' } } satisfies EngineSelector },
      ],
    });
  });

  it('renders the graph: both workload cards exist', async () => {
    render(<TopologyDashboard onClose={() => {}} onLoadPolicy={() => {}} onStartAuthoring={() => {}} />);
    await waitFor(() => expect(fetchTopologyData).toHaveBeenCalledWith('app'));
    // happy-dom RF: nodes render even when edges cannot complete.
    await waitFor(() => expect(screen.getByText('web')).toBeInTheDocument());
    expect(screen.getByText('db')).toBeInTheDocument();
  });

  it('empty namespace shows the guided empty state', async () => {
    vi.mocked(fetchTopologyData).mockResolvedValue({
      pods: PODS,
      policies: [], // policies exist in the inventory but not in THIS ns view
      workloads: [],
    });
    render(<TopologyDashboard onClose={() => {}} onLoadPolicy={() => {}} onStartAuthoring={() => {}} />);
    await waitFor(() => expect(screen.getByText('No policies in this namespace')).toBeInTheDocument());
  });

  it('clicking a workload node opens the drawer with its policies', async () => {
    render(<TopologyDashboard onClose={() => {}} onLoadPolicy={() => {}} onStartAuthoring={() => {}} />);
    await waitFor(() => expect(screen.getByText('web')).toBeInTheDocument());
    fireEvent.click(screen.getByText('web'));
    await waitFor(() => expect(screen.getByText('Affecting policies')).toBeInTheDocument());
    expect(screen.getByText(/web-to-db/)).toBeInTheDocument();
  });

  it('drawer load action calls onLoadPolicy with fetched YAML', async () => {
    const onLoadPolicy = vi.fn();
    render(
      <TopologyDashboard
        onClose={() => {}}
        onLoadPolicy={onLoadPolicy}
        onStartAuthoring={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('web')).toBeInTheDocument());
    fireEvent.click(screen.getByText('web'));
    await waitFor(() => expect(screen.getByText('Load into editor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Load into editor'));
    await waitFor(() => expect(onLoadPolicy).toHaveBeenCalledWith('kind: NetworkPolicy\n', 'app/web-to-db'));
  });

  it('empty-state CTA calls onStartAuthoring', async () => {
    const onStartAuthoring = vi.fn();
    vi.mocked(fetchTopologyData).mockResolvedValue({
      pods: [],
      policies: [],
      workloads: [],
    });
    render(
      <TopologyDashboard
        onClose={() => {}}
        onLoadPolicy={() => {}}
        onStartAuthoring={onStartAuthoring}
      />,
    );
    await waitFor(() => expect(screen.getByText('No policies in this namespace')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create first policy'));
    expect(onStartAuthoring).toHaveBeenCalled();
  });

  it('closing works via the close button', async () => {
    const onClose = vi.fn();
    render(
      <TopologyDashboard
        onClose={onClose}
        onLoadPolicy={() => {}}
        onStartAuthoring={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('web')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Close topology dashboard'));
    expect(onClose).toHaveBeenCalled();
  });
});
