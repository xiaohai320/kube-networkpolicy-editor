import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAuthRoutes, type AuthDeps } from './auth';
import {
  Agent,
  // Node's global fetch runs on Node's *internal* undici copy, which rejects
  // an Agent from the npm undici package (UND_ERR_INVALID_ARG). Fetch and the
  // CA-pinning dispatcher must come from the same undici instance, so both are
  // imported here.
  fetch as undiciFetch,
  type Dispatcher,
} from 'undici';

/**
 * The backend is deliberately thin (ADR-0001): serve the built SPA and proxy
 * `/k8s/*` to the kube-apiserver. No business logic — policies never touch
 * server-side code beyond the byte-for-byte forward.
 */

export interface ProxyConfig {
  /** kube-apiserver base URL, e.g. https://10.0.0.1:6443. */
  apiServer: string;
  /** Bearer token for the upstream apiserver. */
  token: string;
  /** CA bundle content to verify the apiserver cert. `false` disables verification (tests only). */
  ca?: string | false;
}

/** Headers worth forwarding in either direction; everything else is dropped. */
const FORWARDED_HEADERS = ['accept', 'content-type', 'user-agent'];

/**
 * Build the Hono app. Exposed for tests: pass `ca: false` so stubbed upstream
 * fetches don't need TLS plumbing.
 */
export interface AppConfig extends ProxyConfig {
  /** Auth wiring; absent in tests that don't exercise login. */
  auth?: AuthDeps;
}

export function createClusterProxyApp(config: AppConfig): Hono {
  const app = new Hono();

  // Auth (login, OIDC, admin user management) mounts first: these paths are
  // the only ones reachable without a session.
  const auth = config.auth ? createAuthRoutes(config.auth) : null;
  if (auth) {
    app.route('/', auth.routes);
    // /k8s/* is the apiserver's identity — it must never answer unauthenticated.
    app.use('/k8s/*', async (c, next) => {
      if (!auth.hasSession(c.req.header('cookie'))) {
        return c.json({ kind: 'Status', reason: 'Unauthorized', message: 'login required' }, 401);
      }
      await next();
    });
  }
  // One dispatcher for the app lifetime: undici pools connections behind it.
  const dispatcher: Dispatcher | undefined =
    typeof config.ca === 'string'
      ? new Agent({ connect: { ca: config.ca } })
      : undefined;
  // When a CA-pinning dispatcher exists, the fetch must come from the same
  // undici instance as that dispatcher: Node's global fetch runs on Node's
  // internal undici copy, which rejects a foreign Agent (UND_ERR_INVALID_ARG).
  // Without a dispatcher global fetch is fine — and is what tests stub.
  // Resolved per call, not captured at construction: tests stub global fetch
  // after building the app.
  const upstreamFetch: () => typeof globalThis.fetch = dispatcher
    ? () => (undiciFetch as unknown as typeof globalThis.fetch)
    : () => globalThis.fetch;

  app.all('/k8s/*', async c => {
    const upstream = new URL(c.req.path.replace(/^\/k8s/, ''), config.apiServer);
    upstream.search = new URL(c.req.url).search;

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const v = c.req.header(name);
      if (v) headers.set(name, v);
    }
    headers.set('authorization', `Bearer ${config.token}`);

    const method = c.req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.text();

    let upstreamRes: Response;
    try {
      upstreamRes = await upstreamFetch()(upstream.toString(), {
        method,
        headers,
        body,
        // undefined dispatcher = Node's default; tests stub fetch anyway.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dispatcher ? { dispatcher: dispatcher as any } : {}),
      } as RequestInit);
    } catch (err) {
      // The cause carries the real failure (TLS, DNS, socket); surface it in
      // the log so a dead apiserver link is diagnosable from `kubectl logs`.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      console.error(
        'k8s proxy error:',
        err instanceof Error ? err.message : err,
        cause ? `cause: ${cause.code ?? cause.message}` : '',
      );
      return c.json(
        { kind: 'Status', reason: 'ServiceUnavailable', message: String(err) },
        503,
      );
    }

    // Byte-for-byte passthrough: status, allowed headers, body. RBAC (403) and
    // conflict (409) semantics come from the apiserver itself — the proxy adds
    // nothing, which is the point of ADR-0001.
    const resHeaders = new Headers();
    for (const name of ['content-type', 'cache-control']) {
      const v = upstreamRes.headers.get(name);
      if (v) resHeaders.set(name, v);
    }
    // Body-less statuses (204 for DELETE, 304) reject a body in the Response
    // constructor — pass them through without re-reading the body.
    if (upstreamRes.status === 204 || upstreamRes.status === 304) {
      return new Response(null, { status: upstreamRes.status, headers: resHeaders });
    }
    const resBody = await upstreamRes.arrayBuffer();
    return new Response(resBody, { status: upstreamRes.status, headers: resHeaders });
  });

  return app;
}

/** Mount static assets for the production single-image deployment. */
export function withStatic(app: Hono, distDir: string): Hono {
  app.get('*', async c => {
    const path = c.req.path;
    if (path.startsWith('/k8s/')) return c.notFound();
    const file = path === '/' ? '/index.html' : path;
    try {
      const content = await readFile(join(distDir, file));
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      const ext = file.slice(file.lastIndexOf('.'));
      // index.html must never be cached (no Cache-Control header makes
      // browsers heuristic-cache it, serving a stale bundle after every
      // deploy); hashed asset filenames are immutable, so they cache long.
      const cache = ext === '.html'
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=31536000, immutable';
      return new Response(content, {
        headers: {
          'content-type': types[ext] ?? 'application/octet-stream',
          'cache-control': cache,
        },
      });
    } catch {
      // SPA fallback: unknown paths get the shell so client routing works.
      const index = await readFile(join(distDir, 'index.html'));
      return new Response(index, {
        headers: {
          'content-type': 'text/html',
          'cache-control': 'no-cache, no-store, must-revalidate',
        },
      });
    }
  });
  return app;
}

/** Entry point used by the Docker image; not exercised in tests. */
export function startServer(config: AppConfig, distDir: string, port: number): void {
  const app = withStatic(createClusterProxyApp(config), distDir);
  serve({ fetch: app.fetch, port });
}
