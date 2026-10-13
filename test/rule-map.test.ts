import { describe, it, expect } from 'vitest';
import { extractRuleMap, withRuleSentinel } from '@/lib/yaml-rule-map';
import { generateK8sYamlMapped, generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { generateCiliumYamlMapped, generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { detectAndParse } from '@/lib/yaml-parser';
import { createDefaultPolicy, newEndpoint, type Policy } from '@/types/policy';
import yaml from 'js-yaml';

/** Snap the map to the YAML text so ranges can be asserted as slices. */
function line(yamlText: string, n: number): string {
  return yamlText.split('\n')[n - 1] ?? '';
}

function policyWithRules(): Policy {
  const p = createDefaultPolicy();
  const a = newEndpoint('cidr', 'outside', { cidr: '10.0.0.0/8' });
  const b = newEndpoint('labels', 'namespace', { podSelector: { app: 'web' } });
  p.specs[0]!.ingress = [a, b];
  return p;
}

describe('extractRuleMap', () => {
  it('locates a rule block by its sentinel line', () => {
    const policy = policyWithRules();
    const rule = policy.specs[0]!.ingress[0]!;
    const dumped = yaml.dump({ ingress: [withRuleSentinel({ fromCIDR: ['10.0.0.0/8'] }, rule.id)] });
    const { yaml: out, ruleMap } = extractRuleMap(dumped);
    const [from] = ruleMap[rule.id]!;
    expect(line(out, from)).toContain('fromCIDR');
    expect(out).not.toContain('__ruleId');
    expect(out).not.toContain(rule.id);
  });

  it('strips every sentinel line from the final text', () => {
    const policy = policyWithRules();
    const dumped = yaml.dump({
      ingress: policy.specs[0]!.ingress.map(r =>
        withRuleSentinel({ fromCIDR: ['x'] }, r.id),
      ),
    });
    const { yaml: out } = extractRuleMap(dumped);
    expect(out).not.toContain('__ruleId');
    // Two rules in, two ranges, none overlapping.
    const ranges = Object.values(extractRuleMap(dumped).ruleMap);
    expect(ranges).toHaveLength(2);
    for (const [from, to] of ranges) {
      expect(from).toBeLessThanOrEqual(to);
    }
  });
});

describe('generator rule maps', () => {
  it('K8s: ranges land on the rule lines of the emitted YAML', () => {
    const policy = policyWithRules();
    const { yaml: out, ruleMap } = generateK8sYamlMapped(policy);
    for (const rule of policy.specs[0]!.ingress) {
      const [from, to] = ruleMap[rule.id]!;
      const slice = out.split('\n').slice(from - 1, to);
      const block = slice.join('\n');
      expect(block).not.toContain('__ruleId');
      expect(block.length).toBeGreaterThan(0);
      expect(line(out, to)).not.toBe('');
    }
    expect(out).toBe(generateK8sYaml(policy));
    expect(out).not.toContain('__ruleId');
  });

  it('Cilium: ranges land on the rule lines of the emitted YAML', () => {
    const policy = policyWithRules();
    const { yaml: out, ruleMap } = generateCiliumYamlMapped(policy);
    for (const rule of policy.specs[0]!.ingress) {
      const [from, to] = ruleMap[rule.id]!;
      const block = out.split('\n').slice(from - 1, to).join('\n');
      expect(block).not.toContain('__ruleId');
      expect(block.length).toBeGreaterThan(0);
    }
    expect(out).toBe(generateCiliumYaml(policy));
  });

  it('K8s multi-spec: second document ranges are shifted past the separator', () => {
    const policy = policyWithRules();
    const extra = newEndpoint('cidr', 'outside', { cidr: '192.168.0.0/16' });
    const spec2 = { ...policy.specs[0]!, id: 'spec-2', ingress: [extra], egress: [] };
    policy.specs = [policy.specs[0]!, spec2];
    const { yaml: out, ruleMap } = generateK8sYamlMapped(policy);
    const lines = out.split('\n');
    const sep = lines.indexOf('---');
    expect(sep).toBeGreaterThan(0);
    for (const rule of policy.specs[1]!.ingress) {
      const [from] = ruleMap[rule.id]!;
      expect(from).toBeGreaterThan(sep); // second document
    }
    // First document's rules stay before the separator.
    const [firstFrom] = ruleMap[policy.specs[0]!.ingress[0]!.id]!;
    expect(firstFrom).toBeLessThan(sep);
  });
});

describe('hover-highlight integration', () => {
  it('mapped rules survive an import round trip', () => {
    const policy = policyWithRules();
    const { yaml: out } = generateCiliumYamlMapped(policy);
    const { policy: reparsed } = detectAndParse(out);
    expect(reparsed).toBeDefined();
    // The re-parsed policy is a new object; ids change, so the map is per-generation.
    expect(reparsed!.specs[0]!.ingress).toHaveLength(2);
  });
});
