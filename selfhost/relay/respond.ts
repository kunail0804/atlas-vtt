import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

export function sendText(response: ServerResponse, status: number, text: string, contentType = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

/** A request's JSON body ({} where it has none); throws where it is longer than `maxBytes` or no JSON. */
export async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += (chunk as Buffer).length;
    if (length > maxBytes) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
