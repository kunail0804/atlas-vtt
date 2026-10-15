export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** An error the launcher shows as it is: `message` is written for the GM, in French. */
export function failure(status: number, error: string, message: string): Response {
  return json(status, { error, message });
}

export function page(status: number, title: string, text: string): Response {
  const escape = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  const body = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>`
    + '<body style="font-family:system-ui,sans-serif;background:#1e1f24;color:#e6e8ec;display:grid;place-items:center;min-height:100vh;margin:0">'
    + `<main style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-size:1.4rem">${escape(title)}</h1><p>${escape(text)}</p></main></body></html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
