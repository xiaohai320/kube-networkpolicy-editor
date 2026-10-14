// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { ClusterPanel } from '@/components/cluster/ClusterPanel';
import { initI18n } from '@/i18n';

/**
 * Delete flow UI: selection bar, bulk dialog listing, best-effort result
 * panel, and the refresh-on-close contract. Fetch is stubbed per test via
 * routeTable; /auth/me is not touched here because ClusterPanel renders
 * standalone (no login gate).
 */

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  localStorage.clear();
  deleteCalls = [];
  await i18next.changeLanguage('en');
  document.documentElement.lang = 'en';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** What the apiserver returns per list item (its metadata is the source of truth). */
const npItems = [
  { metadata: { name: 'allow-web', namespace: 'web' } },
  { metadata: { name: 'fleet-managed', namespace: 'web', labels: { 'fleet.cattle.io/managed': 'true' } } },
];
const cnpItems = [{ metadata: { name: 'lockdown', namespace: 'db' } }];

/** Route table the fetch stub serves from; tests mutate per scenario. */
let routes: Record<string, Response>;
let deleteCalls: string[];
const key = (method: string, url: string) => `${method} ${url.split('?')[0]}`;

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      if ((init.method ?? 'GET') === 'DELETE') deleteCalls.push(url);
      const hit = routes[key(init.method ?? 'GET', url)];
      if (hit) return hit.clone();
      return new Response('{}', { status: 404 });
    }),
  );
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
const forbidden = (message: string) =>
  new Response(JSON.stringify({ message }), { status: 403, headers: { 'content-type': 'application/json' } });

/** Mount the panel and load the inventory the way a user does: the refresh button. */
async function mountPanel(openPages: Array<{ kind: string; namespace: string; name: string }> = []) {
  stubFetch();
  render(
    <ClusterPanel
      onLoadPolicy={() => {}}
      openPages={openPages}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByLabelText('Load policies'));
  await waitFor(() => expect(screen.getByText('allow-web')).toBeInTheDocument());
}

describe('delete UI', () => {
  it('shows the action bar with the selection count', async () => {
    routes = {
      [key('GET', '/k8s/apis/networking.k8s.io/v1/networkpolicies')]: okJson({ items: npItems }),
      [key('GET', '/k8s/apis/cilium.io/v2/ciliumnetworkpolicies')]: okJson({ items: [] }),
    };
    await mountPanel();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    expect(screen.getByText(/Delete \(2\)/)).toBeInTheDocument();
  });

  it('lists every selected row in the bulk dialog with the managed flag', async () => {
    routes = {
      [key('GET', '/k8s/apis/networking.k8s.io/v1/networkpolicies')]: okJson({ items: npItems }),
      [key('GET', '/k8s/apis/cilium.io/v2/ciliumnetworkpolicies')]: okJson({ items: [] }),
    };
    await mountPanel();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    fireEvent.click(screen.getByText(/Delete \(2\)/));

    // Both rows appear in the dialog (the panel keeps its rows behind the
    // overlay, so counts can exceed the dialog's own — assert presence per row).
    expect(screen.getAllByText('allow-web').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('fleet-managed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Fleet/Helm managed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/managed by Fleet or Helm/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('runs a best-effort batch and shows the result panel, refreshing on close', async () => {
    routes = {
      [key('GET', '/k8s/apis/networking.k8s.io/v1/networkpolicies')]: okJson({ items: npItems }),
      [key('GET', '/k8s/apis/cilium.io/v2/ciliumnetworkpolicies')]: okJson({ items: [] }),
      [key('DELETE', '/k8s/apis/networking.k8s.io/v1/namespaces/web/networkpolicies/allow-web')]: noContent(),
      // denied: a real failure with an upstream message.
      [key('DELETE', '/k8s/apis/networking.k8s.io/v1/namespaces/web/networkpolicies/fleet-managed')]: forbidden('cannot delete in web'),
    };
    await mountPanel();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    fireEvent.click(screen.getByText(/Delete \(2\)/));
    // The row delete buttons behind the overlay also match "Delete" — scope
    // to the dialog (testing-library supports a selector option at runtime).
    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Delete');
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);

    // Result panel: 1 deleted, 1 failed with the upstream message.
    expect(await screen.findByText(/1 deleted, 1 failed/)).toBeInTheDocument();
    expect(screen.getByText('cannot delete in web')).toBeInTheDocument();
    expect(deleteCalls).toHaveLength(2); // best-effort: the second DELETE ran

    // Closing refreshes the inventory: the stubbed list is re-fetched.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.getByText('allow-web')).toBeInTheDocument();
    });
  });

  it('shows the open-tabs note for a single delete', async () => {
    routes = {
      [key('GET', '/k8s/apis/networking.k8s.io/v1/networkpolicies')]: okJson({ items: [npItems[0]!] }),
      [key('GET', '/k8s/apis/cilium.io/v2/ciliumnetworkpolicies')]: okJson({ items: [] }),
    };
    await mountPanel([
      { kind: 'NetworkPolicy', namespace: 'web', name: 'allow-web' },
    ]);
    fireEvent.click(screen.getByLabelText('Delete: web/allow-web'));
    expect(await screen.findByText(/open in 1 tab/)).toBeInTheDocument();
  });

  it('deleting via the row button opens the single confirm dialog', async () => {
    routes = {
      [key('GET', '/k8s/apis/networking.k8s.io/v1/networkpolicies')]: okJson({ items: [] }),
      [key('GET', '/k8s/apis/cilium.io/v2/ciliumnetworkpolicies')]: okJson({ items: cnpItems }),
    };
    stubFetch();
    render(<ClusterPanel onLoadPolicy={() => {}} openPages={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Load policies'));
    await waitFor(() => expect(screen.getAllByText('lockdown').length).toBe(1));
    fireEvent.click(screen.getByLabelText('Delete: db/lockdown'));
    expect(await screen.findByText('Delete from cluster')).toBeInTheDocument();
  });
});
