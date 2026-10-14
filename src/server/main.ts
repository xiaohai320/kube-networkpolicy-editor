import { Agent, fetch as undiciFetch } from 'undici';
import { startServer, type AppConfig } from './app';
import type { AuthDeps } from './auth';

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
  // One CA-pinning dispatcher for the process: the proxy and the auth env
  // self-patch share it (undici pools connections behind the Agent).
  const apiserverDispatcher = ca
    ? new Agent({ connect: { ca } })
    : undefined;

  // Auth: built-in admin + OIDC allowlist. Admin changes persist to a
  // ConfigMap/Secret (never the Deployment env — env changes are pod-template
  // changes and roll the pod, logging everyone out).
  const adminUsername = process.env.ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD;
  const allowedUsers = (process.env.ALLOWED_USERS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const settingsNamespace =
    process.env.POD_NAMESPACE ??
    (await readFile(`${saDir}/namespace`, 'utf8').catch(() => 'default')).trim();
  const oidcIssuer = process.env.OIDC_ISSUER;
  const auth: AuthDeps | null = adminPassword
    ? {
        adminUsername,
        adminPassword,
        allowedUsers,
        apiServer: host,
        token: token.trim(),
        settings: {
          namespace: settingsNamespace,
          configMap: 'netpol-editor-settings',
          secret: 'netpol-editor-settings',
        },
        ...(oidcIssuer
          ? {
              oidc: {
                issuer: oidcIssuer,
                clientId: process.env.OIDC_CLIENT_ID ?? '',
                clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
                // The IdP sits behind a privately-signed cert per the
                // operator's explicit requirement; scope the skip to OIDC only.
                insecureTls: (process.env.OIDC_INSECURE_TLS ?? 'true') === 'true',
              },
            }
          : {}),
        ...(process.env.PUBLIC_ORIGIN ? { publicOrigin: process.env.PUBLIC_ORIGIN } : {}),
      }
    : null;

  const config: AppConfig = {
    apiServer: host,
    token: token.trim(),
    ...(ca ? { ca } : {}),
    ...(auth
      ? {
          auth: {
            ...auth,
            // Same-undici rule as the proxy: fetch and dispatcher from one
            // copy. The dispatcher pins the in-cluster CA — without it the
            // self-patch fails TLS verification against the private CA.
            ...(ca && apiserverDispatcher
              ? {
                  apiFetch: ((url: string | URL | Request, init?: RequestInit) =>
                    undiciFetch(url as never, {
                      ...(init ?? {}),
                      dispatcher: apiserverDispatcher,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } as any)) as unknown as typeof globalThis.fetch,
                }
              : {}),
          },
        }
      : {}),
  };
  startServer(
    config,
    distDir,
    port,
  );
  console.log(`netpol-editor listening on :${port}, proxying ${host}, auth ${auth ? 'on' : 'OFF'}`);
}

void main();
