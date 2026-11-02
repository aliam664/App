import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  root: '.',
  publicDir: 'public',
  base:
    mode === 'branch'
      ? '/App/pages-preview/'
      : mode === 'pages'
        ? process.env.PAGES_BASE_PATH || '/App/'
        : '/',
  define: {
    'import.meta.env.VITE_ASSET_BASE': JSON.stringify(mode === 'branch' ? '/App/public/' : ''),
    'import.meta.env.VITE_BUILD_REVISION': JSON.stringify(process.env.GITHUB_SHA || 'local'),
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    fs: { deny: ['.env', '.env.*', '**/*.{crt,pem,key}', '**/.git/**', '**/.local/**'] },
  },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], port: 5181, strictPort: true },
  build: {
    copyPublicDir: mode !== 'branch',
    outDir: mode === 'branch' ? 'pages-preview' : mode === 'pages' ? 'dist-pages' : 'dist',
    emptyOutDir: true,
  },
}));
