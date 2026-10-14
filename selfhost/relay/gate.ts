import type { WebSocket } from 'ws';
import { CLOSE, MAX_WAITING, type PlayerInfo } from '../../src/app/online/protocol/relay.ts';
import { closeSocket, sendFrame } from './frames.ts';
import { hashOf, matchesHash, newPlayerId, newSecret } from './ids.ts';
import type { SavedGate } from './tableStore.ts';

/** Wrong join codes the gate takes within `WRONG_CODE_WINDOW_MS` before it pauses joins. */
export const WRONG_CODE_LIMIT = 10;
export const WRONG_CODE_WINDOW_MS = 10 * 60_000;
/** The plugin shows a pause for at most 10 minutes (`MAX_PAUSE_MS` in joinGate.ts), so a pause lasts that long. */
export const PAUSE_MS = 10 * 60_000;
/** How long a newcomer waits for the GM's answer before the gate turns them away with `noAnswer`. */
export const NO_ANSWER_MS = 5 * 60_000;

interface Knock {
  readonly id: string;
  readonly name: string;
  socket: WebSocket;
  readonly waitHash: string | null;
  readonly timer: NodeJS.Timeout;
}

export type CodeCheck = 'ok' | 'wrong' | 'paused';

/** What the gate needs of its table. */
export interface GatePorts {
  /** A frame for the GM, dropped while the GM is offline. */
  toGm(frame: Readonly<Record<string, unknown>>): void;
  /** The gate's settings changed and must be saved. */
  changed(): void;
}

/**
 * A table's join gates: the join code, the waiting room, and the pause after too many wrong codes.
 * The GM decides who comes in; the gate only holds newcomers until the GM answers.
 */
export class JoinGate {
  private codeHash: string | null;
  private ask: boolean;
  private wrongCodes: number[] = [];
  private pausedUntil = 0;
  private readonly knocks = new Map<string, Knock>();
  private readonly ports: GatePorts;
  private readonly now: () => number;

  constructor(saved: SavedGate, ports: GatePorts, now: () => number = Date.now) {
    this.codeHash = saved.codeHash;
    this.ask = saved.ask;
    this.ports = ports;
    this.now = now;
  }

  saved(): SavedGate {
    return { codeHash: this.codeHash, ask: this.ask };
  }

  asksTheGm(): boolean {
    return this.ask;
  }

  /** The GM's `gate` frame. A new code ends a pause and forgets the wrong codes, as the plugin's New code promises. */
  set(code: string | null, ask: boolean): void {
    const codeHash = code === null ? null : hashOf(code);
    if (codeHash !== this.codeHash) {
      this.pausedUntil = 0;
      this.wrongCodes = [];
    }
    if (codeHash === this.codeHash && ask === this.ask) return;
    this.codeHash = codeHash;
    this.ask = ask;
    this.ports.changed();
  }

  check(code: string | undefined): CodeCheck {
    const now = this.now();
    if (now < this.pausedUntil) return 'paused';
    if (this.codeHash === null) return 'ok';
    if (code !== undefined && matchesHash(code, this.codeHash)) return 'ok';
    this.wrongCodes = this.wrongCodes.filter((at) => now - at < WRONG_CODE_WINDOW_MS);
    this.wrongCodes.push(now);
    if (this.wrongCodes.length >= WRONG_CODE_LIMIT) {
      this.pausedUntil = now + PAUSE_MS;
      this.wrongCodes = [];
      this.ports.toGm({ t: 'gate-paused', until: this.pausedUntil });
    }
    return 'wrong';
  }

  /** The newcomers waiting for an answer, for the GM's welcome. */
  waiting(): PlayerInfo[] {
    return [...this.knocks.values()].map((knock) => ({ id: knock.id, name: knock.name }));
  }

  socketCount(): number {
    return this.knocks.size;
  }

  /** A newcomer knocks. `waits`: their page keeps a token that takes the wait up again after a reconnect. */
  knock(socket: WebSocket, name: string, waits: boolean): void {
    if (this.knocks.size >= MAX_WAITING) {
      closeSocket(socket, CLOSE.tooManyKnocks, 'too many waiting');
      return;
    }
    const id = newPlayerId();
    const wait = waits ? newSecret() : null;
    const timer = setTimeout(() => this.timeOut(id), NO_ANSWER_MS);
    const knock: Knock = { id, name, socket, waitHash: wait === null ? null : hashOf(wait), timer };
    this.knocks.set(id, knock);
    this.watch(knock, socket);
    sendFrame(socket, wait === null ? { t: 'waiting' } : { t: 'waiting', wait });
    this.ports.toGm({ t: 'knock', id, name });
  }

  /** A newcomer back with their wait token: the same wait goes on with the new socket. False when no wait has that token. */
  resume(socket: WebSocket, wait: string): boolean {
    for (const knock of this.knocks.values()) {
      if (knock.waitHash === null || !matchesHash(wait, knock.waitHash)) continue;
      const previous = knock.socket;
      knock.socket = socket;
      closeSocket(previous, CLOSE.replaced, 'replaced');
      this.watch(knock, socket);
      sendFrame(socket, { t: 'waiting' });
      return true;
    }
    return false;
  }

  /** The GM answered a knock: the newcomer is handed back to be seated, or turned away. Null for a knock that is gone. */
  answer(id: string, admit: boolean): { socket: WebSocket; id: string; name: string } | null {
    const knock = this.knocks.get(id);
    if (knock === undefined) return null;
    this.forget(knock);
    if (admit) return { socket: knock.socket, id: knock.id, name: knock.name };
    this.ports.toGm({ t: 'knock-gone', id });
    closeSocket(knock.socket, CLOSE.declined, 'declined');
    return null;
  }

  /** Every waiting newcomer is sent away, when the table ends. */
  closeAll(code: number): void {
    for (const knock of [...this.knocks.values()]) {
      this.forget(knock);
      closeSocket(knock.socket, code, 'table ended');
    }
  }

  private watch(knock: Knock, socket: WebSocket): void {
    socket.on('close', () => {
      // Only the socket that still holds the wait ends it; a replaced one says nothing.
      if (this.knocks.get(knock.id) !== knock || knock.socket !== socket) return;
      this.forget(knock);
      this.ports.toGm({ t: 'knock-gone', id: knock.id });
    });
  }

  private timeOut(id: string): void {
    const knock = this.knocks.get(id);
    if (knock === undefined) return;
    this.forget(knock);
    this.ports.toGm({ t: 'knock-gone', id });
    closeSocket(knock.socket, CLOSE.noAnswer, 'no answer');
  }

  private forget(knock: Knock): void {
    clearTimeout(knock.timer);
    this.knocks.delete(knock.id);
  }
}
