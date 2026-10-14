import { CLOSE, MAX_PLAYERS, isOtherVersion, parseClientFrame } from '../../src/app/online/protocol/relay.ts';
import { closeSocket } from './frames.ts';
import { hashOf, newSecret, newTableCode } from './ids.ts';
import type { Link } from './link.ts';
import { Table } from './table.ts';
import type { TableStore } from './tableStore.ts';

/** A socket that sends no hello within this long is closed. */
const HELLO_TIMEOUT_MS = 10_000;

/** Which listener a socket arrived on: the GM's loopback side or the tunnelled public side. */
export type Side = 'gm' | 'public';

/** What `POST /api/tables` answers (`readCreated` in createdTable.ts). */
export interface CreatedTable {
  readonly code: string;
  readonly secret: string;
  readonly maxPlayers: number;
}

/** The relay's tables, saved on every change. The relay hosts for one GM, so a new table supersedes the last. */
export class Tables {
  private readonly tables = new Map<string, Table>();
  private readonly store: TableStore;

  constructor(store: TableStore) {
    this.store = store;
    for (const saved of store.load()) this.tables.set(saved.code, this.open(saved));
  }

  create(): CreatedTable {
    for (const table of [...this.tables.values()]) table.end(CLOSE.superseded);
    const code = newTableCode();
    const secret = newSecret();
    const saved = { code, secretHash: hashOf(secret), maxPlayers: MAX_PLAYERS, gate: { codeHash: null, ask: true }, players: [] };
    this.tables.set(code, this.open(saved));
    this.save();
    return { code, secret, maxPlayers: MAX_PLAYERS };
  }

  /** A socket opened on `/api/tables/<code>/socket`: its first frame must be the hello its side expects. */
  join(link: Link, code: string, side: Side): void {
    const timer = setTimeout(() => closeSocket(link.socket, CLOSE.protocol, 'no hello'), HELLO_TIMEOUT_MS);
    link.socket.on('close', () => clearTimeout(timer));
    link.onText((text) => {
      clearTimeout(timer);
      if (isOtherVersion(text)) return closeSocket(link.socket, CLOSE.version, 'protocol version');
      const frame = parseClientFrame(text);
      if (frame === null || frame.t !== 'hello') return closeSocket(link.socket, CLOSE.protocol, 'expected hello');
      const table = this.tables.get(code);
      if (table === undefined) return closeSocket(link.socket, CLOSE.ended, 'no such table');
      // The GM's hello is taken only over loopback, a player's only through the tunnel.
      if (frame.role === 'gm') {
        if (side !== 'gm') return closeSocket(link.socket, CLOSE.protocol, 'wrong side');
        return table.attachGm(link, frame.secret);
      }
      if (side !== 'public') return closeSocket(link.socket, CLOSE.protocol, 'wrong side');
      table.attachPlayer(link, frame);
    });
  }

  private open(saved: ConstructorParameters<typeof Table>[0]): Table {
    return new Table(saved, {
      changed: () => this.save(),
      ended: (table) => {
        this.tables.delete(table.code);
        this.save();
      },
    });
  }

  private save(): void {
    this.store.save([...this.tables.values()].map((table) => table.saved()));
  }
}
