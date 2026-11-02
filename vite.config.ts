import { defineConfig } from 'vite';
import production from './config/production-public.json';
export default defineConfig(({ mode }) => ({
  root: '.',
  publicDir: 'public',
  base: mode.endsWith('branch')
    ? '/App/pages-preview/'
    : mode.endsWith('pages')
      ? process.env.PAGES_BASE_PATH || '/App/'
      : '/',
  define: {
    ...((mode === 'production' || mode.startsWith('live-')) && {
      'import.meta.env.VITE_API_BASE': JSON.stringify(
        process.env.VITE_API_BASE || production.api_base,
      ),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
        process.env.VITE_SUPABASE_URL || production.supabase_url,
      ),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY || production.supabase_publishable_key,
      ),
    }),
    'import.meta.env.VITE_ASSET_BASE': JSON.stringify(
      mode.endsWith('branch') ? '/App/public/' : '',
    ),
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
    copyPublicDir: !mode.endsWith('branch'),
    outDir: mode.endsWith('branch')
      ? 'pages-preview'
      : mode.endsWith('pages')
        ? 'dist-pages'
        : 'dist',
    emptyOutDir: true,
  },
}));
