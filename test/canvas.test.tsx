// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import type { PolicySpec } from '@/types/policy';
import type { EditorState } from '@/state/actions';
import { PolicyProvider } from '@/state/context';
import { initI18n } from '@/i18n';
import { VisualCanvas } from '@/components/canvas/VisualCanvas';
import { ep, policy } from './helpers';

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  await i18next.changeLanguage('en');
});

afterEach(cleanup);

const stateWith = (specOverrides: Partial<PolicySpec> = {}): EditorState => ({
  policy: policy({}, specOverrides),
  activeSpec: 0,
});

/** Render only the canvas, so the seeded policy is exactly what the arrows read. */
const renderCanvas = (state = stateWith()) =>
  render(
    <PolicyProvider initial={state}>
      <VisualCanvas />
    </PolicyProvider>,
  );

/** The connecting arrows only — lucide icons render `<path>` elements too. */
const arrowPaths = (): SVGPathElement[] =>
  Array.from(document.querySelectorAll('path')).filter(p => {
    const stroke = p.getAttribute('stroke');
    return stroke !== null && stroke.startsWith('var(--color-arrow-');
  });

describe('arrow colours', () => {
  it('draws an allow rule with an arrowhead even when the baseline is deny-all', async () => {
    renderCanvas(stateWith({ ingress: [ep('all', 'cluster')], defaultDenyIngress: true }));

    await waitFor(() => expect(arrowPaths()).toHaveLength(1));
    expect(document.getElementById('arrow-head')).toBeInTheDocument();
    expect(document.querySelector('#arrow-head path')).toHaveAttribute(
      'fill',
      'var(--color-arrow-allow)',
    );

    for (const arrow of arrowPaths()) {
      expect(arrow).toHaveAttribute('stroke', 'var(--color-arrow-allow)');
      expect(arrow).toHaveAttribute('stroke-width', '2');
      expect(arrow).toHaveAttribute('marker-end', 'url(#arrow-head)');
    }
  });

  it('never draws a deny-coloured arrow in either direction', async () => {
    renderCanvas(
      stateWith({
        ingress: [ep('all', 'cluster')],
        egress: [ep('fqdn', 'outside', { matchName: 'api.example.com' })],
      }),
    );

    await waitFor(() => expect(arrowPaths()).toHaveLength(2));
    expect(
      arrowPaths().some(p => p.getAttribute('stroke') === 'var(--color-arrow-deny)'),
    ).toBe(false);
  });
});

describe('baseline badges', () => {
  it('reads a direction that has rules as an allow-list, not as denied', () => {
    renderCanvas(stateWith({ ingress: [ep('all', 'cluster')] }));

    const badge = screen.getByTitle('Ingress: 1 rule, default-deny implied');
    expect(badge).toBeDisabled();
    expect(badge).toHaveClass('bg-surface');
    expect(screen.queryByText('Default Deny')).not.toBeInTheDocument();
  });

  it('reads a baseline with no rules as deny-all', () => {
    renderCanvas(stateWith({ defaultDenyIngress: true }));

    const badge = screen.getByTitle('Ingress: click to allow all');
    expect(badge).not.toBeDisabled();
    expect(badge).toHaveClass('bg-badge-deny-bg');
    expect(screen.getByText('Default Deny')).toBeInTheDocument();
  });

  it('reads an unset baseline as allow-all', () => {
    renderCanvas();

    const badge = screen.getByTitle('Ingress: click to deny everything');
    expect(badge).toHaveClass('bg-badge-allow-bg');
    // Both directions are unset here, so both read as allow-all.
    expect(screen.getAllByText('Default Allow')).toHaveLength(2);
  });

  it('flips a direction from allow-all to deny-all on click', async () => {
    renderCanvas();

    await act(async () => {
      fireEvent.click(screen.getByTitle('Ingress: click to deny everything'));
    });

    expect(screen.getByTitle('Ingress: click to allow all')).toBeInTheDocument();
    expect(screen.getByText('Default Deny')).toBeInTheDocument();
  });

  it('pluralises the rule count on the allow-list badge', () => {
    renderCanvas(
      stateWith({
        ingress: [ep('all', 'cluster'), ep('cidr', 'outside', { cidr: '10.0.0.0/8' })],
      }),
    );

    expect(screen.getByTitle('Ingress: 2 rules, default-deny implied')).toBeInTheDocument();
    expect(screen.getByText('2 rules')).toBeInTheDocument();
  });
});
