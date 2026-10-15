/** Headers on every answer: nothing is cached, sniffed, framed, or sent on as a referrer. */
const SAFE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

/** The service's pages run no script and load nothing; they may not be framed (clickjacking). */
const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SAFE_HEADERS } });
}

/** An error the launcher shows as it is: `message` is written for the GM, in French. */
export function failure(status: number, error: string, message: string): Response {
  return json(status, { error, message });
}

const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** A page of the service. `action`: a button, as a link the GM must press (never followed by itself). */
export function page(status: number, title: string, text: string, action?: { label: string; href: string }): Response {
  const button = action === undefined ? ''
    : `<p><a href="${escape(action.href)}" style="display:inline-block;padding:.7rem 1.2rem;border-radius:8px;background:#6b78ff;color:#fff;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>`;
  const body = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>`
    + '<body style="font-family:system-ui,sans-serif;background:#1e1f24;color:#e6e8ec;display:grid;place-items:center;min-height:100vh;margin:0">'
    + `<main style="max-width:30rem;padding:2rem;text-align:center"><h1 style="font-size:1.4rem">${escape(title)}</h1><p>${escape(text)}</p>${button}</main></body></html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_POLICY, 'x-frame-options': 'DENY', ...SAFE_HEADERS } });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
