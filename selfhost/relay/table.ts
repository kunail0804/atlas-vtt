import type { WebSocket } from 'ws';
import {
  ALL_PLAYERS, CLOSE, PROTOCOL_VERSION, isOtherVersion, parseClientFrame, type PlayerHello, type PlayerInfo,
} from '../../src/app/online/protocol/relay.ts';
import { closeSocket, sendFrame, sendText } from './frames.ts';
import { JoinGate } from './gate.ts';
import { hashOf, matchesHash, newPlayerId, newSecret } from './ids.ts';
import type { Link } from './link.ts';
import { RateLimit } from './rateLimit.ts';
import type { SavedTable } from './tableStore.ts';

/** A player's page may send this many frames a second, after a burst of `PLAYER_BURST`. */
const PLAYER_FRAMES_PER_SECOND = 60;
const PLAYER_BURST = 120;

interface Seat {
  readonly id: string;
  name: string;
  readonly keyHash: string;
  link: Link | null;
}

/** What a table needs of the relay around it. */
export interface TablePorts {
  /** The table's saved state changed. */
  changed(): void;
  /** The table is over: the relay forgets it. */
  ended(table: Table): void;
}

/**
 * One table: the GM's socket, the seated players and the join gate. The relay carries game messages
 * without reading them: a GM's `send` goes to one player or all, a player's goes to the GM with the
 * sender's id stamped by the relay.
 */
export class Table {
  readonly code: string;
  private readonly secretHash: string;
  private readonly maxPlayers: number;
  private readonly seats = new Map<string, Seat>();
  private gm: Link | null = null;
  /** Waiting newcomers keep their link, so an admitted one is seated on it. */
  private readonly linksByKnockSocket = new WeakMap<WebSocket, Link>();
  private readonly gate: JoinGate;
  private readonly ports: TablePorts;

  constructor(saved: SavedTable, ports: TablePorts) {
    this.code = saved.code;
    this.secretHash = saved.secretHash;
    this.maxPlayers = saved.maxPlayers;
    this.ports = ports;
    for (const player of saved.players) this.seats.set(player.id, { id: player.id, name: player.name, keyHash: player.keyHash, link: null });
    this.gate = new JoinGate(saved.gate, { toGm: (frame) => this.toGm(frame), changed: () => ports.changed() });
  }

  saved(): SavedTable {
    const players = [...this.seats.values()].map((seat) => ({ id: seat.id, name: seat.name, keyHash: seat.keyHash }));
    return { code: this.code, secretHash: this.secretHash, maxPlayers: this.maxPlayers, gate: this.gate.saved(), players };
  }

  // ---- The GM ----

  /** A GM's hello with the table's secret. A second GM socket replaces the first. */
  attachGm(link: Link, secret: string): void {
    if (!matchesHash(secret, this.secretHash)) {
      closeSocket(link.socket, CLOSE.badSecret, 'bad secret');
      return;
    }
    const previous = this.gm;
    this.gm = link;
    if (previous !== null) closeSocket(previous.socket, CLOSE.replaced, 'replaced');
    link.onText((text) => this.fromGm(link, text));
    link.socket.on('close', () => {
      if (this.gm !== link) return;
      this.gm = null;
      this.toPlayers({ t: 'gm', online: false });
    });
    const waiting = this.gate.waiting();
    sendFrame(link.socket, { t: 'welcome', role: 'gm', players: this.connectedPlayers(), ...(waiting.length === 0 ? {} : { waiting }) });
    if (previous === null) this.toPlayers({ t: 'gm', online: true });
  }

  private fromGm(link: Link, text: string): void {
    if (isOtherVersion(text)) return closeSocket(link.socket, CLOSE.version, 'protocol version');
    const frame = parseClientFrame(text);
    if (frame === null || frame.t === 'hello') return closeSocket(link.socket, CLOSE.protocol, 'malformed frame');
    switch (frame.t) {
      case 'send':
        this.route(frame.to ?? ALL_PLAYERS, frame.body);
        return;
      case 'kick':
        this.kick(frame.id);
        return;
      case 'gate':
        this.gate.set(frame.code, frame.ask);
        return;
      case 'admit':
      case 'decline': {
        const admitted = this.gate.answer(frame.id, frame.t === 'admit');
        if (admitted !== null) this.seatAdmitted(admitted.socket, admitted.id, admitted.name);
        return;
      }
      case 'end':
        this.end(CLOSE.ended);
        return;
      default: {
        const unknown: never = frame;
        return unknown;
      }
    }
  }

  private route(to: string, body: unknown): void {
    // Serialised once, then sent as text to every reader: a scene goes to all players at once.
    const text = JSON.stringify({ v: PROTOCOL_VERSION, t: 'game', body });
    if (to === ALL_PLAYERS) {
      for (const seat of this.seats.values()) if (seat.link !== null) sendText(seat.link.socket, text);
      return;
    }
    const seat = this.seats.get(to);
    if (seat?.link) sendText(seat.link.socket, text);
  }

  private kick(id: string): void {
    const seat = this.seats.get(id);
    if (seat === undefined) return;
    this.seats.delete(id);
    this.ports.changed();
    if (seat.link === null) return;
    const socket = seat.link.socket;
    seat.link = null;
    this.toGm({ t: 'player-left', id });
    closeSocket(socket, CLOSE.kicked, 'kicked');
  }

  /** Ends the table for everyone: `ended` when the GM ends it, `superseded` when a newer table replaces it. */
  end(gmCode: number): void {
    for (const seat of this.seats.values()) {
      if (seat.link !== null) closeSocket(seat.link.socket, CLOSE.ended, 'table ended');
      seat.link = null;
    }
    this.gate.closeAll(CLOSE.ended);
    if (this.gm !== null) closeSocket(this.gm.socket, gmCode, 'table ended');
    this.gm = null;
    this.ports.ended(this);
  }

  // ---- Players ----

  /** A player's hello on the public side. */
  attachPlayer(link: Link, hello: PlayerHello): void {
    if (hello.key !== undefined) {
      const seat = this.seatWithKey(hello.key);
      if (seat !== null) return this.seat(link, seat, hello.key, hello.name);
    }
    if (hello.wait !== undefined && this.gate.resume(link.socket, hello.wait)) {
      link.onText(() => closeSocket(link.socket, CLOSE.protocol, 'waiting'));
      return;
    }
    const check = this.gate.check(hello.code);
    if (check === 'paused') return closeSocket(link.socket, CLOSE.paused, 'joins paused');
    if (check === 'wrong') return closeSocket(link.socket, CLOSE.wrongCode, 'wrong code');
    if (this.gate.asksTheGm()) {
      // A waiting newcomer only sends keep-alives until the GM answers.
      link.onText(() => closeSocket(link.socket, CLOSE.protocol, 'waiting'));
      this.gate.knock(link.socket, hello.name, hello.waits === true);
      this.linksByKnockSocket.set(link.socket, link);
      return;
    }
    this.seatNewcomer(link, newPlayerId(), hello.name);
  }

  private seatAdmitted(socket: WebSocket, id: string, name: string): void {
    const link = this.linksByKnockSocket.get(socket);
    if (link === undefined) return;
    if (this.connectedCount() >= this.maxPlayers) {
      this.toGm({ t: 'knock-gone', id, full: true });
      closeSocket(socket, CLOSE.full, 'table full');
      return;
    }
    this.toGm({ t: 'knock-gone', id });
    this.seatNewcomer(link, id, name);
  }

  private seatNewcomer(link: Link, id: string, name: string): void {
    if (this.connectedCount() >= this.maxPlayers) return closeSocket(link.socket, CLOSE.full, 'table full');
    const key = newSecret();
    const seat: Seat = { id, name, keyHash: hashOf(key), link: null };
    this.seats.set(id, seat);
    this.ports.changed();
    this.seat(link, seat, key, name);
  }

  private seat(link: Link, seat: Seat, key: string, name: string): void {
    if (seat.link === null && this.connectedCount() >= this.maxPlayers) return closeSocket(link.socket, CLOSE.full, 'table full');
    const previous = seat.link;
    seat.link = link;
    if (seat.name !== name) {
      seat.name = name;
      this.ports.changed();
    }
    if (previous !== null) closeSocket(previous.socket, CLOSE.replaced, 'replaced');
    const limit = new RateLimit(PLAYER_FRAMES_PER_SECOND, PLAYER_BURST);
    link.onText((text) => this.fromPlayer(seat, link, limit, text));
    link.socket.on('close', () => {
      if (seat.link !== link) return;
      seat.link = null;
      this.toGm({ t: 'player-left', id: seat.id });
    });
    sendFrame(link.socket, { t: 'welcome', role: 'player', id: seat.id, key, gmOnline: this.gm !== null });
    this.toGm({ t: 'player-joined', id: seat.id, name: seat.name });
  }

  private fromPlayer(seat: Seat, link: Link, limit: RateLimit, text: string): void {
    if (!limit.take()) return closeSocket(link.socket, CLOSE.rateLimited, 'too many frames');
    if (isOtherVersion(text)) return closeSocket(link.socket, CLOSE.version, 'protocol version');
    const frame = parseClientFrame(text);
    // A player only ever sends game messages, and they always go to the GM.
    if (frame === null || frame.t !== 'send' || frame.to !== undefined) return closeSocket(link.socket, CLOSE.protocol, 'malformed frame');
    this.toGm({ t: 'game', from: seat.id, body: frame.body });
  }

  private seatWithKey(key: string): Seat | null {
    for (const seat of this.seats.values()) if (matchesHash(key, seat.keyHash)) return seat;
    return null;
  }

  // ---- Shared ----

  /** Open sockets at this table: the GM, seated players and waiting newcomers. */
  socketCount(): number {
    return (this.gm === null ? 0 : 1) + this.connectedCount() + this.gate.socketCount();
  }

  private connectedCount(): number {
    let count = 0;
    for (const seat of this.seats.values()) if (seat.link !== null) count += 1;
    return count;
  }

  private connectedPlayers(): PlayerInfo[] {
    const players: PlayerInfo[] = [];
    for (const seat of this.seats.values()) if (seat.link !== null) players.push({ id: seat.id, name: seat.name });
    return players;
  }

  private toGm(frame: Readonly<Record<string, unknown>>): void {
    if (this.gm !== null) sendFrame(this.gm.socket, frame);
  }

  private toPlayers(frame: Readonly<Record<string, unknown>>): void {
    for (const seat of this.seats.values()) if (seat.link !== null) sendFrame(seat.link.socket, frame);
  }
}
