// Test-only static host: intentionally no Vite transforms and no API server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('.');
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url || '/', 'http://test.invalid').pathname).replace(
      /^\/App\//,
      '',
    );
    if (!path || path.endsWith('/')) path += 'index.html';
    if (
      !['index.html'].includes(path) &&
      !path.startsWith('pages-preview/') &&
      !path.startsWith('public/') &&
      path !== 'apps/web/src/main.ts'
    ) {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(root, path);
    if (!file.startsWith(root + '/')) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.ts': 'text/plain',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.woff2': 'font/woff2',
      '.mp4': 'video/mp4',
      '.json': 'application/json',
    };
    res
      .writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
      .end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(5182, '0.0.0.0');
