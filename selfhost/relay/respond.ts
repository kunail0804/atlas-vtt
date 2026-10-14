import type { ServerResponse } from 'node:http';

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

export function sendText(response: ServerResponse, status: number, text: string, contentType = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(text) });
  response.end(text);
}
