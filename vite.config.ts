/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/netpol-editor/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      // Dev-mode cluster access (ADR-0001): the browser talks to same-origin
      // /k8s/* and this middleware forwards to the apiserver. Target and token
      // ride on request headers set by the UI (x-k8s-target / x-k8s-token,
      // fed from sessionStorage), so re-pasting credentials needs no restart.
      // The forwarding headers are stripped before the request leaves.
      name: 'k8s-dev-proxy',
      configureServer(server) {
        server.middlewares.use('/k8s', (req, res) => {
          const target = req.headers['x-k8s-target'];
          const token = req.headers['x-k8s-token'];
          if (typeof target !== 'string' || typeof token !== 'string') {
            res.statusCode = 400;
            res.end(JSON.stringify({ message: 'Missing x-k8s-target/x-k8s-token headers' }));
            return;
          }
          delete req.headers['x-k8s-target'];
          delete req.headers['x-k8s-token'];
          const upstream = new URL(req.url ?? '/', target);
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            try {
              const upRes = await fetch(upstream, {
                method: req.method,
                headers: new Headers(
                  Object.fromEntries(
                    Object.entries({ ...req.headers, authorization: `Bearer ${token}` }).filter(
                      (pair): pair is [string, string] => typeof pair[1] === 'string',
                    ),
                  ),
                ),
                body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : Buffer.concat(chunks),
              });
              res.statusCode = upRes.status;
              for (const [k, v] of upRes.headers) {
                if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
              }
              res.end(Buffer.from(await upRes.arrayBuffer()));
            } catch (err) {
              res.statusCode = 502;
              res.end(JSON.stringify({ message: String(err) }));
            }
          });
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // The generators, parser and validators are pure and DOM-free: run them in
    // node. jsdom and happy-dom both return zero-size getBoundingClientRect and
    // lack ResizeObserver, so ArrowLayer's geometry can't be exercised in a
    // DOM shim at all — component tests opt in per-file instead.
    environment: 'node',
    globals: false,
    setupFiles: [],
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
    },
  },
})
