import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sendText } from './respond.ts';

const PLAYER_DIST = path.join(import.meta.dirname, '..', 'player', 'dist');
const INDEX_FILE = path.join(PLAYER_DIST, 'index.html');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** The file a path names inside the dist folder, or index.html for a path that is malformed or climbs out of it. */
function fileForPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return INDEX_FILE;
  }
  const requested = path.normalize(path.join(PLAYER_DIST, decoded));
  return requested.startsWith(PLAYER_DIST + path.sep) ? requested : INDEX_FILE;
}

async function sendFile(response: ServerResponse, file: string): Promise<void> {
  const bytes = await readFile(file);
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
  // Built assets carry a content hash in their name, so they never change under the same URL.
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  response.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': cache });
  response.end(bytes);
}

/** Serves the built player page (`npm run player:build`); every unknown path gets index.html. */
export async function servePlayerPage(response: ServerResponse, pathname: string): Promise<void> {
  const file = fileForPath(pathname);
  try {
    await sendFile(response, file);
    return;
  } catch {
    // Not a file of the build: the page itself answers below.
  }
  try {
    await sendFile(response, INDEX_FILE);
  } catch {
    sendText(response, 503, 'The player page is not built. Run: npm run player:build');
  }
}
