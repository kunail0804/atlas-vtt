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

/**
 * The page loads only its own files, talks only to this relay, and may not be framed. Workers come
 * from blobs (PixiJS builds some), images from blobs (assets arrive over the socket).
 */
function pagePolicy(host: string | undefined): string {
  // The Host header is the client's word: only a plain host name with a port may enter the policy.
  const plain = host !== undefined && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host);
  const socket = plain ? ` wss://${host} ws://${host}` : '';
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", `connect-src 'self'${socket}`, "worker-src 'self' blob:", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
}

async function sendFile(response: ServerResponse, file: string, host: string | undefined): Promise<void> {
  const bytes = await readFile(file);
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
  // Built assets carry a content hash in their name, so they never change under the same URL.
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  response.writeHead(200, {
    'content-type': type, 'content-length': bytes.length, 'cache-control': cache,
    'content-security-policy': pagePolicy(host), 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    // The table code is in the link's hash, which browsers never send; this keeps the path to itself too.
    'referrer-policy': 'no-referrer',
  });
  response.end(bytes);
}

/** Serves the built player page (`npm run player:build`); every unknown path gets index.html. */
export async function servePlayerPage(response: ServerResponse, pathname: string, host?: string): Promise<void> {
  const file = fileForPath(pathname);
  try {
    await sendFile(response, file, host);
    return;
  } catch {
    // Not a file of the build: the page itself answers below.
  }
  try {
    await sendFile(response, INDEX_FILE, host);
  } catch {
    sendText(response, 503, 'The player page is not built. Run: npm run player:build');
  }
}
