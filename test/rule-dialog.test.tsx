// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const renderCanvas = (state = stateWith()) =>
  render(
    <PolicyProvider initial={state}>
      <VisualCanvas />
    </PolicyProvider>,
  );

/** The add trigger for one group card; both columns carry one. */
const openAdd = (direction: 'Ingress' | 'Egress', group: string) =>
  fireEvent.click(screen.getByLabelText(`New ${direction} rule (${group})`));

describe('adding a rule', () => {
  it('opens a dialog instead of expanding the card', () => {
    renderCanvas();
    openAdd('Ingress', 'Outside Cluster');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Rule type')).toBeInTheDocument();
    expect(within(dialog).getByText(/CIDR/)).toBeInTheDocument();
    // The card itself stayed collapsed: no field editor leaked into the column.
    expect(screen.queryByText('Except CIDRs')).not.toBeInTheDocument();
  });

  it('keeps Add disabled until a rule type is picked', () => {
    renderCanvas();
    openAdd('Ingress', 'Outside Cluster');

    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
  });

  it('adds the rule the picked type describes', async () => {
    renderCanvas();
    openAdd('Ingress', 'Outside Cluster');

    fireEvent.click(screen.getByRole('button', { name: /CIDR/ }));
    fireEvent.change(screen.getByPlaceholderText('10.0.0.0/8'), {
      target: { value: '10.2.1.0/28' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('10.2.1.0/28')).toBeInTheDocument();
  });

  it('cancels without touching the column', async () => {
    renderCanvas();
    openAdd('Ingress', 'Outside Cluster');

    fireEvent.click(screen.getByRole('button', { name: /CIDR/ }));
    fireEvent.change(screen.getByPlaceholderText('10.0.0.0/8'), {
      target: { value: '10.2.1.0/28' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('10.2.1.0/28')).not.toBeInTheDocument();
  });

  it('closes on Escape and keeps the previous state', async () => {
    renderCanvas(stateWith({ ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] }));

    openAdd('Ingress', 'In Cluster');
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The seeded rule survived the aborted dialog.
    expect(screen.getByText('10.0.0.0/8')).toBeInTheDocument();
  });
});

describe('editing a rule', () => {
  it('pre-fills the dialog from the row and saves the change', async () => {
    renderCanvas(stateWith({ ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] }));

    fireEvent.click(screen.getByText('10.0.0.0/8'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Edit Ingress rule (Outside Cluster)');
    // Editing does not offer a different rule type.
    expect(within(dialog).queryByText('Rule type')).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('10.0.0.0/8'), {
      target: { value: '192.168.0.0/16' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('192.168.0.0/16')).toBeInTheDocument();
    expect(screen.queryByText('10.0.0.0/8')).not.toBeInTheDocument();
  });

  it('deletes the rule from the edit dialog', async () => {
    renderCanvas(stateWith({ ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] }));

    fireEvent.click(screen.getByText('10.0.0.0/8'));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('10.0.0.0/8')).not.toBeInTheDocument();
  });
});

describe('group scope', () => {
  it('states what each group reaches under its title', () => {
    renderCanvas();
    // Both the ingress and the egress column state the same scope.
    expect(screen.getAllByText("Pods in this policy's namespace")).toHaveLength(2);
    expect(screen.getAllByText('Pods anywhere in this cluster')).toHaveLength(2);
    expect(screen.getAllByText('Endpoints outside the cluster')).toHaveLength(2);
  });

  it('never asks for a namespace inside the namespace group', () => {
    renderCanvas();
    openAdd('Ingress', 'In Namespace');
    fireEvent.click(screen.getByRole('button', { name: /Pod selector/ }));

    const dialog = screen.getByRole('dialog');
    // "Pod selector" appears twice: as a still-selectable type and as the field label.
    expect(within(dialog).getAllByText(/Pod selector/)).toHaveLength(2);
    expect(within(dialog).queryByText('Namespace')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Namespace labels')).not.toBeInTheDocument();
  });

  it('offers a namespace only in the cluster group', () => {
    renderCanvas();
    openAdd('Ingress', 'In Cluster');
    fireEvent.click(screen.getByRole('button', { name: /Pod selector/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Namespace')).toBeInTheDocument();
    expect(within(dialog).getByText('Namespace labels')).toBeInTheDocument();
  });
});
