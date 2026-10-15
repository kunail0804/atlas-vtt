const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  let text = '';
  for (const byte of random) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The code a person may have to read: no 0/O or 1/I to mix up. */
export function userCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = crypto.getRandomValues(new Uint8Array(8));
  return [...random].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
