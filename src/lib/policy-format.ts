/**
 * The policy-format registry: one place that knows everything about the two
 * manifest formats the editor speaks. Every site that used to branch on
 * `format === 'cilium'` to pick a kind string or a generator reads from here
 * instead, so adding a format touches one table — not the half-dozen call
 * sites that previously each kept their own copy of the mapping.
 *
 * Parsing is NOT in the table: `detectAndParse` needs multi-document
 * handling and error context a bare `parse` function can't carry, so the
 * format → parser dispatch lives with the parser.
 */

import type { Policy, PolicyFormat } from '@/types/policy';
import type { MappedYaml } from './yaml-rule-map';
import { generateK8sYamlMapped } from './yaml-gen-k8s';
import { generateCiliumYamlMapped } from './yaml-gen-cilium';

export interface PolicyFormatDef {
  /** The resource kind this format's generated manifests carry. */
  kind: 'NetworkPolicy' | 'CiliumNetworkPolicy';
  /** YAML text plus the hover-highlight rule map, per format's rules. */
  generate: (policy: Policy) => MappedYaml;
}

export const POLICY_FORMATS: Record<PolicyFormat, PolicyFormatDef> = {
  k8s: {
    kind: 'NetworkPolicy',
    generate: generateK8sYamlMapped,
  },
  cilium: {
    kind: 'CiliumNetworkPolicy',
    generate: generateCiliumYamlMapped,
  },
};

/** The kind a policy of the given format generates as. */
export function kindOfFormat(format: PolicyFormat): PolicyFormatDef['kind'] {
  return POLICY_FORMATS[format].kind;
}
