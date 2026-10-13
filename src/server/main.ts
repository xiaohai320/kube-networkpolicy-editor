import { startServer } from './app';

/**
 * Docker image entry point. In-cluster credentials come from the mounted
 * ServiceAccount — no env plumbing for tokens, ever (ADR-0001).
 */
const host = process.env.KUBE_API_SERVER ?? 'https://kubernetes.default.svc';
const port = Number(process.env.PORT ?? 8080);
const distDir = process.env.DIST_DIR ?? 'dist';

async function main() {
  const { readFile } = await import('node:fs/promises');
  const saDir = '/var/run/secrets/kubernetes.io/serviceaccount';
  // In-cluster the SA token is the only credential; a KUBE_TOKEN env override
  // exists for running the image outside a cluster (CI smoke tests).
  const token =
    (await readFile(`${saDir}/token`, 'utf8').catch(() => undefined)) ??
    process.env.KUBE_TOKEN;
  if (!token) {
    console.error('No ServiceAccount token or KUBE_TOKEN; cannot proxy to the apiserver.');
    process.exit(1);
  }

  // Pin the in-cluster CA so the proxy verifies the apiserver identity.
  const ca = await readFile(`${saDir}/ca.crt`, 'utf8').catch(() => undefined);
  startServer(
    { apiServer: host, token: token.trim(), ...(ca ? { ca } : {}) },
    distDir,
    port,
  );
  console.log(`netpol-editor listening on :${port}, proxying ${host}`);
}

void main();
