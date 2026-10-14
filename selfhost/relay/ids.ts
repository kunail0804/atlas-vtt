import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Table codes and player ids are lowercase base32 without padding (TABLE_CODE_PATTERN, PLAYER_ID_PATTERN).
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) text += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return text;
}

/** 128 random bits: 26 characters. */
export function newTableCode(): string {
  return base32(randomBytes(16));
}

/** 96 random bits: 20 characters. */
export function newPlayerId(): string {
  return base32(randomBytes(12));
}

/** A host secret, player key or wait token: 256 random bits in base64url, 43 characters. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Secrets and join codes are kept only as this hash, on disk and in memory. */
export function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function matchesHash(text: string, hash: string): boolean {
  const candidate = Buffer.from(hashOf(text), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
