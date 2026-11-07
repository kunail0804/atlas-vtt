import { MAX_PLAYERS, TABLE_CODE_PATTERN } from '../protocol/index.ts';
import { accessText, SERVER_SIGNED_OUT_TEXT, UNREACHABLE_TEXT } from './account/accountView.ts';
import { accessRefusal } from './account/relayAccount.ts';
import { OUTDATED_TEXT } from './gmLevel.ts';
import { t } from '../../i18n';

/** A table the relay created: its code (in the join link), the host secret (only ever in the GM's hello) and its seats. */
export interface CreatedTable {
  readonly code: string;
  readonly secret: string;
  /** The players the table seats at once, by the GM's plan. */
  readonly maxPlayers: number;
  /** Self-hosted fork: the campaign's public address, where players join (`https://name-vtt.kunlab.cc`). */
  readonly playerOrigin: string;
}

/** Self-hosted fork: a relay's public address as it answered it, or null for anything that is no bare http(s) origin. */
export function playerOriginOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

/** The seats a relay answered with; a relay from before plans seats `MAX_PLAYERS`. */
export function seatsOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PLAYERS ? value : MAX_PLAYERS;
}

/** What the GM reads when the relay binds the campaign's link to another account. */
export const LINK_TAKEN_TEXT = t('online.server.linkTaken');

/** The sentence for an answer of the relay that made no table. Who may host is the server's word: this only reads it out. */
function refusalText(status: number, error: unknown): string {
  if (status === 401) return SERVER_SIGNED_OUT_TEXT;
  if (status === 403) return accessText(accessRefusal(error));
  if (status === 409 && error === 'link-taken') return LINK_TAKEN_TEXT;
  if (status === 426) return OUTDATED_TEXT;
  if (status === 429) return t('online.server.tooMany');
  if (status === 503 && error === 'accounts-unreachable') return UNREACHABLE_TEXT;
  if (status === 503 && error === 'not-configured') return t('online.server.notConfigured');
  if (status === 503) return t('online.server.busy');
  return t('online.server.failed', { status: String(status) });
}

/** The created table from the relay's answer, or a sentence saying why there is none. */
export function readCreated(status: number, body: unknown): CreatedTable | string {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (status !== 201) return refusalText(status, fields.error);
  const { code, secret } = fields;
  const playerOrigin = playerOriginOf(fields.playerOrigin);
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code) || typeof secret !== 'string' || secret.length < 32 || playerOrigin === null) return t('online.server.badAnswer');
  return { code, secret, maxPlayers: seatsOf(fields.maxPlayers), playerOrigin };
}
