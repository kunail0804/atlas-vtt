import { appendFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { FEEDBACK_PATH, MAX_DIAGNOSTIC_BODY, parseErrorReport, parseFeedback, REPORTS_PATH } from '../../src/app/online/protocol/diagnostics.ts';
import { RateLimit } from './rateLimit.ts';
import { sendJson } from './respond.ts';

/** The largest each log file grows to; past it the relay answers `busy` and keeps what it has. */
export const MAX_DIAGNOSTIC_FILE = 1024 * 1024;

const FILES: Readonly<Record<string, { readonly file: string; readonly parse: (value: unknown) => unknown }>> = {
  [FEEDBACK_PATH]: { file: 'feedback.jsonl', parse: parseFeedback },
  [REPORTS_PATH]: { file: 'reports.jsonl', parse: parseErrorReport },
};

/** The body, or null once it is longer than `max` bytes. */
async function readBody(request: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += (chunk as Buffer).length;
    if (length > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface Diagnostics {
  /** Whether the path is one of these two. */
  owns(pathname: string): boolean;
  handle(request: IncomingMessage, response: ServerResponse, pathname: string): void;
}

/**
 * The plugin's feedback and its error reports (`POST /api/feedback`, `POST /api/reports`, GM side only).
 * The hosted Atlas service would keep them; a self-hosted relay keeps them in its data folder, one JSON
 * object per line, as the plugin's own parser reads them, so the GM can read or send them on.
 */
export function createDiagnostics(dataDir: string, now: () => number = Date.now): Diagnostics {
  const rate = new RateLimit(0.2, 10, now);
  return {
    owns: (pathname) => Object.hasOwn(FILES, pathname),
    handle(request, response, pathname) {
      const target = FILES[pathname];
      if (target === undefined) return sendJson(response, 404, { error: 'not-found' });
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method-not-allowed' });
      void (async (): Promise<void> => {
        const body = await readBody(request, MAX_DIAGNOSTIC_BODY);
        if (body === null) return sendJson(response, 413, { error: 'too-large' });
        let parsed: unknown = null;
        try {
          parsed = target.parse(JSON.parse(body));
        } catch {
          parsed = null;
        }
        if (parsed === null) return sendJson(response, 400, { error: 'malformed' });
        if (!rate.take()) return sendJson(response, 429, { error: 'rate' });
        const file = path.join(dataDir, target.file);
        const size = await stat(file).then((info) => info.size, () => 0);
        const line = `${JSON.stringify({ at: new Date(now()).toISOString(), ...(parsed as object) })}\n`;
        if (size + Buffer.byteLength(line) > MAX_DIAGNOSTIC_FILE) return sendJson(response, 503, { error: 'full' });
        await appendFile(file, line, { mode: 0o600 });
        sendJson(response, 202, { ok: true });
      })().catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: 'failed' });
      });
    },
  };
}
