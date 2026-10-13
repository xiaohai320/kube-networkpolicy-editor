import { describe, expect, it } from 'vitest';
import type { Endpoint, PolicySpec } from '@/types/policy';
import { directionState } from '@/state/reducer';
import { ep, emptyPolicySpec } from './helpers';

const rules = (count: number): Endpoint[] =>
  Array.from({ length: count }, () => ep('cidr', 'outside', { cidr: '10.0.0.0/8' }));

const spec = (overrides: Partial<PolicySpec> = {}): PolicySpec => ({
  ...emptyPolicySpec(),
  ...overrides,
});

describe('directionState', () => {
  it('allows everything when there is no spec to read', () => {
    expect(directionState(undefined, 'ingress')).toBe('allow-all');
    expect(directionState(undefined, 'egress')).toBe('allow-all');
  });

  it('reads an empty direction off its own baseline flag', () => {
    expect(directionState(spec(), 'ingress')).toBe('allow-all');
    expect(directionState(spec(), 'egress')).toBe('allow-all');
    expect(directionState(spec({ defaultDenyIngress: true }), 'ingress')).toBe('deny-all');
    expect(directionState(spec({ defaultDenyEgress: true }), 'egress')).toBe('deny-all');
  });

  it('treats any rule as an allow-list, whatever the baseline flag says', () => {
    expect(directionState(spec({ ingress: rules(1) }), 'ingress')).toBe('allow-list');
    expect(directionState(spec({ egress: rules(3) }), 'egress')).toBe('allow-list');
    expect(
      directionState(spec({ ingress: rules(1), defaultDenyIngress: true }), 'ingress'),
    ).toBe('allow-list');
    expect(
      directionState(spec({ egress: rules(2), defaultDenyEgress: true }), 'egress'),
    ).toBe('allow-list');
  });

  it('ignores the other direction entirely', () => {
    expect(directionState(spec({ ingress: rules(1) }), 'egress')).toBe('allow-all');
    expect(directionState(spec({ egress: rules(1) }), 'ingress')).toBe('allow-all');
    expect(
      directionState(spec({ egress: rules(1), defaultDenyIngress: true }), 'ingress'),
    ).toBe('deny-all');
  });
});
