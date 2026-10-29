/** Where this browser keeps its key, for every table of this address. */
const DEVICE_KEY = 'atlas-vtt:device';
const VALID = /^[A-Za-z0-9_-]{43}$/;

/**
 * This browser's key: 32 random bytes in base64url, made once and kept. The GM's Atlas keeps
 * only its SHA-256, and knows the player by it from one table to the next.
 */
export function deviceKey(): string {
  const kept = window.localStorage.getItem(DEVICE_KEY);
  if (kept !== null && VALID.test(kept)) return kept;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  window.localStorage.setItem(DEVICE_KEY, key);
  return key;
}
