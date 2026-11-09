import { saltOf, type SaltStore } from '../account/saltStore.ts';
import type { StoreResult } from './storeClient.ts';

/** How long a salt the relay did not hand out is not asked for again (a relay without the store answers 404). */
export const SALT_RETRY_MS = 10 * 60 * 1000;
/** How long building a reference waits for a salt still being fetched before players are handed none. */
export const SALT_WAIT_MS = 5_000;

export interface AssetSaltPorts {
  readonly store: SaltStore;
  /** Asks the relay for the account's salt (`ASSET_ROUTES.salt`). */
  fetch(): Promise<StoreResult<unknown>>;
  /** Whether an account is signed in on this device. */
  signedIn(): boolean;
  /** The relay refused the token: it is forgotten with the salt. */
  signedOutByServer(): void;
  now(): number;
  /** A promise that settles after `ms`. */
  sleep(ms: number): Promise<void>;
}

/**
 * The GM's salt: kept in secret storage, fetched from the relay at sign-in and on first need while
 * signed in, the same for the account on every device (so earlier uploads stay deduplicated), and gone
 * on sign-out and on a 401. A kept salt is asked of the relay once per session before ids are made with
 * it, and replaced by the relay's: each self-hosted campaign's relay has a salt of its own, and ids made
 * with another one are refused at upload, so players would be shown no assets. A relay that cannot be
 * reached leaves the kept salt in use; one that does not hand one out (an older relay, a failure) and
 * none kept leaves the GM without ids, quietly: players are then shown no assets.
 */
export class AssetSalt {
  private fetching: Promise<Uint8Array<ArrayBuffer> | null> | null = null;
  private failedAt = Number.NEGATIVE_INFINITY;
  /** Whether the relay handed out the kept salt in this session. */
  private confirmed = false;

  constructor(private readonly ports: AssetSaltPorts) {}

  /** The salt kept now, or null. */
  get(): Uint8Array<ArrayBuffer> | null {
    return this.ports.signedIn() ? this.ports.store.get() : null;
  }

  /** The salt: the one the relay confirmed, or fetched once while signed in (`force`: anew, even soon after a failure). */
  ensure(force = false): Promise<Uint8Array<ArrayBuffer> | null> {
    const kept = this.get();
    if (kept !== null && this.confirmed && !force) return Promise.resolve(kept);
    if (!this.ports.signedIn()) return Promise.resolve(null);
    if (!force && this.ports.now() - this.failedAt < SALT_RETRY_MS) return Promise.resolve(kept);
    if (force) this.confirmed = false;
    this.fetching ??= this.fetch().finally(() => (this.fetching = null));
    return this.fetching;
  }

  /** The salt, waiting at most `SALT_WAIT_MS` for one being fetched; then the kept one, if any. */
  async soon(): Promise<Uint8Array<ArrayBuffer> | null> {
    const kept = this.get();
    if (kept !== null && this.confirmed) return kept;
    return Promise.race([this.ensure(), this.ports.sleep(SALT_WAIT_MS).then(() => this.get())]);
  }

  clear(): void {
    this.ports.store.clear();
    this.failedAt = Number.NEGATIVE_INFINITY;
    this.confirmed = false;
  }

  private async fetch(): Promise<Uint8Array<ArrayBuffer> | null> {
    const answer = await this.ports.fetch();
    if (!answer.ok) {
      if (answer.trouble === 'signed-out') {
        this.ports.signedOutByServer();
        return null;
      }
      this.failedAt = this.ports.now();
      return this.get();
    }
    const salt = saltOf(answer.value);
    if (salt === null || !this.ports.signedIn()) {
      this.failedAt = this.ports.now();
      return this.get();
    }
    this.ports.store.set(salt);
    this.confirmed = true;
    return salt;
  }
}
