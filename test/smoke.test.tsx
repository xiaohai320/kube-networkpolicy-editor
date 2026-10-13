// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
});

afterEach(cleanup);

describe('<App/>', () => {
  it('mounts the canvas, the target node and the YAML panel', () => {
    render(<App />);
    expect(screen.getByText('Ingress Sources')).toBeInTheDocument();
    expect(screen.getByText('Egress Destinations')).toBeInTheDocument();
    expect(screen.getByText('All pods in namespace')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes Network Policy')).toBeInTheDocument();
    expect(screen.getByText('Cilium Network Policy')).toBeInTheDocument();
  });

  it('switches the whole interface to Chinese from the toolbar', async () => {
    render(<App />);
    expect(screen.getByText('Ingress Sources')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTitle('中文'));
    });
    expect(await screen.findByText('入站来源')).toBeInTheDocument();
    expect(screen.getByText('出站目标')).toBeInTheDocument();
    expect(screen.queryByText('Ingress Sources')).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh');
  });

  it('switches back to English', async () => {
    render(<App />);
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
