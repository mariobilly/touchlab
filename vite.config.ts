import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 4748,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4747' },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any)
