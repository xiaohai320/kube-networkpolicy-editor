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
  plugins: [react(), tailwindcss()],
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
