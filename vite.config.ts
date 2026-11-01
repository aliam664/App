import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/web', publicDir: '../../public',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: '../../dist', emptyOutDir: true },
});
