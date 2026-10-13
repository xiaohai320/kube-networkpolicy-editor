// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import App from '@/App';
import { initI18n } from '@/i18n';

beforeAll(() => {
  // `main.tsx` does this too; the test renders `<App/>` on its own.
  initI18n();
});

beforeEach(async () => {
  // Without `globals: true` @testing-library does not auto-clean, and the
  // language survives from the previous test, so reset both.
  localStorage.clear();
  await i18next.changeLanguage('en');
  document.documentElement.lang = 'en';
  // The login gate probes /auth/me on mount; tests exercise the editor, not
  // the gate, so answer as a signed-in admin.
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.includes('/auth/me')) {
      return new Response(JSON.stringify({ authenticated: true, user: 'admin', role: 'admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<App/>', () => {
  it('mounts the canvas, the target node and the YAML panel', async () => {
    render(<App />);
    // The gate holds the UI until the /auth/me probe resolves.
    expect(await screen.findByText('Ingress Sources')).toBeInTheDocument();
    expect(screen.getByText('Egress Destinations')).toBeInTheDocument();
    expect(screen.getByText('All pods in namespace')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes Network Policy')).toBeInTheDocument();
    expect(screen.getByText('Cilium Network Policy')).toBeInTheDocument();
  });

  it('switches the whole interface to Chinese from the toolbar', async () => {
    render(<App />);
    await screen.findByText('Ingress Sources');

    await act(async () => {
      fireEvent.click(screen.getByTitle('中文'));
    });
    expect(await screen.findByText('入站来源')).toBeInTheDocument();
    expect(screen.getByText('出站目标')).toBeInTheDocument();
    expect(screen.queryByText('Ingress Sources')).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh');
  });

  it('closes the active tab and falls back to a sibling without blanking', async () => {
    render(<App />);
    await screen.findByText('Ingress Sources');
    // One initial tab; add one more, then close the active one.
    fireEvent.click(screen.getByLabelText('Add new policy page'));
    expect(screen.getAllByText(/Policy \d/).length).toBe(2);

    // The active tab is the newest; its close button is visible on hover.
    const activeTab = screen.getAllByText(/Policy \d/).at(-1)!.closest('div')!;
    const closeBtn = activeTab.querySelector('button[aria-label^="Delete"]')!;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);

    // The bar still shows the remaining tab, and the canvas still renders.
    expect(screen.getAllByText(/Policy \d/).length).toBe(1);
    expect(screen.getByText('Ingress Sources')).toBeInTheDocument();
    expect(screen.getByText('Cilium Network Policy')).toBeInTheDocument();
  });

  it('switches back to English', async () => {
    render(<App />);
    await screen.findByText('Ingress Sources');

    await act(async () => {
      fireEvent.click(screen.getByTitle('中文'));
    });
    await screen.findByText('入站来源');

    await act(async () => {
      fireEvent.click(screen.getByTitle('English'));
    });
    expect(await screen.findByText('Ingress Sources')).toBeInTheDocument();
    expect(screen.queryByText('入站来源')).not.toBeInTheDocument();
  });
});
