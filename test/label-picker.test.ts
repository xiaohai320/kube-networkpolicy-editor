import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listWorkloadLabels } from '@/lib/cluster-api';

/**
 * Workload-label API tests: the fetch stub records requests; assertions cover
 * the three workload APIs being queried and labels being extracted from
 * `spec.template.metadata.labels` (pod-creating controllers only).
 */

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let calls: string[] = [];

describe('listWorkloadLabels', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        calls.push(String(input));
        const url = String(input);
        if (url.includes('deployments')) {
          return json({ items: [depItem()] });
        }
        if (url.includes('statefulsets')) {
          return json({ items: [stsItem()] });
        }
        return json({ items: [] });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('queries the three pod-creating workload APIs', async () => {
    await listWorkloadLabels();
    expect(calls.some(c => c.includes('/apis/apps/v1/deployments'))).toBe(true);
    expect(calls.some(c => c.includes('/apis/apps/v1/statefulsets'))).toBe(true);
    expect(calls.some(c => c.includes('/apis/apps/v1/daemonsets'))).toBe(true);
  });

  it('extracts template labels with namespace and workload name', async () => {
    const out = await listWorkloadLabels();
    expect(out).toContainEqual({
      namespace: 'web',
      workload: 'nginx',
      labels: { app: 'nginx' },
    });
  });

  it('skips workloads whose template has no labels', async () => {
    const out = await listWorkloadLabels();
    // stsItem carries no labels → excluded; only the labeled deployment survives.
    expect(out).toHaveLength(1);
  });
});

function depItem(): Record<string, unknown> {
  return {
    metadata: { name: 'nginx', namespace: 'web' },
    spec: { template: { metadata: { labels: { app: 'nginx' } } } },
  };
}

function stsItem(): Record<string, unknown> {
  return {
    metadata: { name: 'broken', namespace: 'web' },
    spec: { template: {} },
  };
}
