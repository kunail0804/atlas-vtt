/**
 * A world backup as it lies on disk: one JSON file holding every file of the world data at the
 * moment it was made, each as base64, so any file comes back byte for byte. Pure: no vault here.
 */

import { CAMPAIGNS_FOLDER } from '../campaigns/campaignPaths';
import { ONLINE_DATA_PATH } from '../online/gm/onlineData';
import { SHARES_PATH } from '../players/shares';

/** The format this Atlas writes; a backup of another format is not restored. */
export const BACKUP_FORMAT = 1;

/** Why a backup was made: by the GM, by the schedule, or to keep what a restore replaced. */
export type BackupReason = 'manual' | 'scheduled' | 'before-restore';

const REASONS: readonly BackupReason[] = ['manual', 'scheduled', 'before-restore'];

export interface WorldBackup {
  readonly format: number;
  /** When it was made, in milliseconds since the epoch. */
  readonly createdAt: number;
  readonly reason: BackupReason;
  /** The vault it was made in (Obsidian's id of the vault), or null when the backup does not say. */
  readonly vaultId: string | null;
  /** Vault path → the file's bytes as base64. */
  readonly files: Readonly<Record<string, string>>;
}

/** What a restore does to each file of the world data. */
export interface RestorePlan {
  /** Files that exist now and get the backup's content. */
  readonly replaced: readonly string[];
  /** Files the backup holds and the vault lacks now. */
  readonly added: readonly string[];
  /** Files that exist now and the backup did not hold: they go. */
  readonly removed: readonly string[];
  /** Files the backup holds exactly as they are now. */
  readonly unchanged: readonly string[];
}

/** A backslash is a separator on Windows, and control characters name no file Atlas writes. */
function hasForbiddenCharacter(path: string): boolean {
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (character === '\\' || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Whether `path` belongs to the world data: online play's data file, the compendium's shares or a
 * file inside the worlds' folder. A backup is a file anyone can edit, so no path outside these is
 * ever written from one.
 */
export function isWorldDataPath(path: string): boolean {
  if (path === ONLINE_DATA_PATH || path === SHARES_PATH) return true;
  if (!path.startsWith(`${CAMPAIGNS_FOLDER}/`) || hasForbiddenCharacter(path)) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The backup in `text`, or null when it is no backup this Atlas can restore whole. */
export function readBackup(text: string): WorldBackup | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) return null;
  const { createdAt, reason, vaultId, files } = value;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (vaultId !== undefined && typeof vaultId !== 'string') return null;
  if (typeof reason !== 'string' || !REASONS.includes(reason as BackupReason)) return null;
  if (!isRecord(files)) return null;
  const read: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    // One file that cannot be read makes the whole backup unusable: a partial restore is no restore.
    if (!isWorldDataPath(path) || typeof data !== 'string' || !BASE64.test(data)) return null;
    read[path] = data;
  }
  return { format: BACKUP_FORMAT, createdAt, reason: reason as BackupReason, vaultId: vaultId ?? null, files: read };
}

export function backupText(backup: WorldBackup): string {
  return JSON.stringify(backup);
}

/** The name a backup made at `createdAt` is saved under; the n-th made in the same millisecond takes `-<n>`. */
export function backupName(createdAt: number, reason: BackupReason, n = 1): string {
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  return n === 1 ? `world-${stamp}-${reason}.json` : `world-${stamp}-${reason}-${n}.json`;
}

/** Whether a file of a backup folder is listed as a backup; nothing else there is ever read or removed. */
export const isBackupFileName = (name: string): boolean => name.startsWith('world-') && name.endsWith('.json');

const NAME_PATTERN = /^world-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(manual|scheduled|before-restore)(?:-(\d+))?\.json$/;

/** What a backup's name says of it, read without opening the file; null for a name Atlas did not give. */
export interface BackupNameParts {
  readonly stamp: string;
  readonly reason: BackupReason;
  readonly n: number;
}

export function readBackupName(name: string): BackupNameParts | null {
  const match = NAME_PATTERN.exec(name);
  if (match === null) return null;
  const [, stamp = '', reason = '', n] = match;
  return { stamp, reason: reason as BackupReason, n: n === undefined ? 1 : Number.parseInt(n, 10) };
}

/**
 * The backups among `names` that Atlas named, newest first, by their names alone. The stamp is an
 * ISO date, so it sorts as text; within one millisecond the later number was made later.
 */
export function newestFirst(names: readonly string[]): string[] {
  const named = names.flatMap((name) => {
    const parts = readBackupName(name);
    return parts === null ? [] : [{ name, parts }];
  });
  const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  named.sort((a, b) => byText(b.parts.stamp, a.parts.stamp) || b.parts.n - a.parts.n || byText(b.name, a.name));
  return named.map((entry) => entry.name);
}

/** Whether two sets of files hold the same paths with the same bytes. */
export function sameFiles(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const paths = Object.keys(a);
  if (paths.length !== Object.keys(b).length) return false;
  return paths.every((path) => b[path] === a[path]);
}

/** What restoring `backup` over the `current` files changes, each list sorted by path. */
export function planRestore(current: Readonly<Record<string, string>>, backup: WorldBackup): RestorePlan {
  const replaced: string[] = [];
  const added: string[] = [];
  const unchanged: string[] = [];
  for (const [path, data] of Object.entries(backup.files)) {
    const now = current[path];
    if (now === undefined) added.push(path);
    else if (now === data) unchanged.push(path);
    else replaced.push(path);
  }
  const removed = Object.keys(current).filter((path) => backup.files[path] === undefined);
  const byPath = (a: string, b: string): number => a.localeCompare(b);
  return { replaced: replaced.toSorted(byPath), added: added.toSorted(byPath), removed: removed.toSorted(byPath), unchanged: unchanged.toSorted(byPath) };
}

/** Whether a restore following `plan` changes nothing. */
export const changesNothing = (plan: RestorePlan): boolean => plan.replaced.length === 0 && plan.added.length === 0 && plan.removed.length === 0;
