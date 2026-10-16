// @vitest-environment happy-dom

import './rf-polyfill';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import type { PolicySpec } from '@/types/policy';
import type { EditorState } from '@/state/actions';
import { PolicyProvider } from '@/state/context';
import { initI18n } from '@/i18n';
import { VisualCanvas } from '@/components/canvas/VisualCanvas';
import { buildFlowEdges } from '@/components/canvas/flow/edges';
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

/** Render only the canvas, so the seeded policy is exactly what the edges read. */
const renderCanvas = (state = stateWith()) =>
  render(
    <PolicyProvider initial={state}>
      <VisualCanvas />
    </PolicyProvider>,
  );

describe('flow canvas render', () => {
  /**
   * The polyfill carries RF's node pipeline under happy-dom, so the mounted
   * canvas is assertable at the DOM level — cards, handles, drag wiring.
   * Edge RENDERING (path elements) is still not carried: that leg runs
   * through an async measurement pipeline the stubs can't complete, so the
   * edges are asserted as DATA in 'edge construction' below.
   */
  it('mounts all nine flow nodes and marks the interactive ones draggable', () => {
    renderCanvas();

    // 6 rule-group cards + 1 target pod + 2 column labels.
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(9);
    // Cards drag from their header; rows and buttons opt out via nodrag.
    expect(document.querySelectorAll('.react-flow__node .nodrag')).not.toHaveLength(0);
    // RF renders the pane and the dot grid background.
    expect(document.querySelector('.react-flow__pane')).not.toBeNull();
    expect(document.querySelector('.react-flow__background')).not.toBeNull();
  });

  it('renders handles on rule-group cards and the target pod', () => {
    renderCanvas(stateWith({ ingress: [ep('all', 'cluster')] }));

    // Target pod: one target handle (left) + one source handle (right).
    const targetNode = document.querySelector('[data-id="target"]')!;
    expect(targetNode.querySelectorAll('.react-flow__handle')).toHaveLength(2);
    // Rule-group node with one rule: row handle + mirrored column handle.
    const clusterNode = document.querySelector('[data-id="ingress-cluster"]')!;
    expect(clusterNode.querySelectorAll('.react-flow__handle')).toHaveLength(2);
  });

  it('gives each rule row a positioning context for its handle', () => {
    renderCanvas(
      stateWith({ ingress: [ep('all', 'cluster'), ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] }),
    );

    // RF handles are position:absolute — without a positioned row wrapper
    // every handle would anchor to the card's vertical midpoint instead of
    // its own row.
    const clusterCard = document.querySelector('[data-id="ingress-cluster"]')!;
    const rowHandles = [...clusterCard.querySelectorAll('.react-flow__handle')].filter(
      h => h.getAttribute('data-handleid') !== null && h.getAttribute('data-handleid') !== '',
    );
    expect(rowHandles).toHaveLength(1); // the cluster card holds one rule
    const outsideCard = document.querySelector('[data-id="ingress-outside"]')!;
    expect(outsideCard.querySelectorAll('.react-flow__handle[data-handleid]:not([data-handleid=""])')).toHaveLength(1);
    for (const handle of rowHandles) {
      expect(handle.closest('.relative')).not.toBeNull();
    }
  });
});

describe('edge construction', () => {
  /**
   * The old ArrowLayer drew one SVG path per rule and the tests asserted the
   * path attributes in the DOM. React Flow renders edges only after its own
   * async measurement pipeline completes, which happy-dom's geometry stubs
   * cannot carry — so the edge DATA is asserted here (pure function) and the
   * AllowEdge component's colouring is a one-line style map, reviewed rather
   * than DOM-tested.
   */
  it('builds one allow-coloured edge per rule, in both directions', () => {
    const edges = buildFlowEdges(
      [ep('all', 'cluster'), ep('cidr', 'outside', { cidr: '10.0.0.0/8' })],
      [ep('fqdn', 'outside', { matchName: 'api.example.com' })],
    );

    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge.type).toBe('allow');
      expect(edge.markerEnd).toMatchObject({ type: 'arrowclosed', color: 'var(--color-arrow-allow)' });
    }
    // Ingress flows rule -> target; egress flows target -> rule.
    const [ingressCluster, ingressCidr, egressFqdn] = edges;
    expect(ingressCluster!.source).toBe('ingress-cluster');
    expect(ingressCluster!.target).toBe('target');
    expect(ingressCidr!.source).toBe('ingress-outside');
    expect(egressFqdn!.source).toBe('target');
    expect(egressFqdn!.target).toBe('egress-outside');
    // Each edge anchors to its rule row's handle.
    expect(ingressCluster!.sourceHandle).toBeDefined();
    expect(egressFqdn!.targetHandle).toBeDefined();
    // Edge ids embed the rule id, so YAML-hover can key on them.
    expect(ingressCluster!.id).toContain(ingressCluster!.sourceHandle!);
  });

  it('produces no edges when the policy has no rules', () => {
    expect(buildFlowEdges([], [])).toEqual([]);
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
