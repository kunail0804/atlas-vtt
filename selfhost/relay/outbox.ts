/** What the outbox needs of a player's socket. */
export interface OutboxSocket {
  send(text: string): void;
}

/** Paced and bulk bytes a link may hold unanswered however slow it is: one asset chunk with its envelope. */
export const MIN_WINDOW_BYTES = 70 * 1024;
/** Paced and bulk bytes a link may hold unanswered however fast it is. */
export const MAX_WINDOW_BYTES = 8 * 1024 * 1024;
/**
 * How long the paced and bulk bytes on their way may wait in the buffers between the relay and the player, at
 * the speed the page's acks show: about how long a message sent after them waits behind them.
 */
export const TARGET_DELAY_MS = 1000;
/** The shortest stretch of acks one speed sample covers: acks that arrive together say nothing of the link. */
export const SAMPLE_MS = 250;
/** Weight of the newest speed sample in the running estimate. */
const SPEED_WEIGHT = 0.25;

interface InFlight {
  readonly bytes: number;
  readonly sentAt: number;
}

/** A frame that keeps its place among the others: `paced` ones count against the window, the rest go once their turn comes. */
interface OrderedFrame {
  readonly text: string;
  readonly paced: boolean;
}

interface Sample {
  readonly start: number;
  bytes: number;
}

/**
 * What the relay sends one player's socket, in the GM's lanes (`SendLane`). Paced frames (parts of
 * a large message) and bulk frames (asset chunks) go only while what is already on its way would
 * wait less than `TARGET_DELAY_MS`, so a dragged token never queues behind a whole map or a scene's
 * walls in the buffers between the relay and a slow player. The relay cannot see those buffers: it
 * reaches the player through cloudflared on loopback, which drains at once. Only the page's acks
 * tell how fast the link really is.
 *
 * Ordered frames (paced ones and those of no lane) keep the order the GM sent them in: a delta must
 * never reach the page before the whole message it follows. Live frames go at once, before anything
 * waiting. Bulk frames go last, when no ordered frame waits. A page that does not ack (`acks` false)
 * gets every frame at once, as before acks.
 */
export class PlayerOutbox {
  private readonly socket: OutboxSocket;
  private readonly acks: boolean;
  private readonly now: () => number;
  private readonly ordered: OrderedFrame[] = [];
  private readonly bulk: string[] = [];
  private readonly inFlight: InFlight[] = [];
  private inFlightBytes = 0;
  private sent = 0;
  private acked = 0;
  /** Bytes a millisecond the link delivered lately, or null before the first sample. */
  private speed: number | null = null;
  /** The shortest time a bulk frame took from leaving to its ack: the link's delay with nothing queued. */
  private minRoundTrip = Number.POSITIVE_INFINITY;
  private sample: Sample | null = null;
  private closed = false;

  constructor(socket: OutboxSocket, acks: boolean, now: () => number = Date.now) {
    this.socket = socket;
    this.acks = acks;
    this.now = now;
  }

  /**
   * Bulk bytes the link may hold unanswered now: what it delivers in its own round trip plus
   * `TARGET_DELAY_MS`. Below its speed the window grows each round trip; at its speed the extra
   * bytes wait about `TARGET_DELAY_MS`.
   */
  get window(): number {
    if (this.speed === null) return MIN_WINDOW_BYTES;
    const roundTrip = Number.isFinite(this.minRoundTrip) ? this.minRoundTrip : 0;
    return Math.min(MAX_WINDOW_BYTES, Math.max(MIN_WINDOW_BYTES, this.speed * (roundTrip + TARGET_DELAY_MS)));
  }

  /** Frames waiting to go, ordered and bulk. */
  get waitingCount(): number {
    return this.ordered.length + this.bulk.length;
  }

  /** A live frame: at once, before anything waiting. */
  sendLive(text: string): void {
    if (!this.closed) this.socket.send(text);
  }

  /** A frame in order with the others; `paced` (a part of a large message) counts against the window. */
  sendOrdered(text: string, paced: boolean): void {
    if (this.closed) return;
    if (!this.acks) return this.socket.send(text);
    this.ordered.push({ text, paced });
    this.pump();
  }

  /** A bulk frame (an asset chunk): after every ordered frame, within the window. */
  sendBulk(text: string): void {
    if (this.closed) return;
    if (!this.acks) return this.socket.send(text);
    this.bulk.push(text);
    this.pump();
  }

  /** The page received its first `count` paced and bulk frames on this socket. */
  ack(count: number): void {
    if (!this.acks || this.closed || count <= this.acked || count > this.sent) return;
    const now = this.now();
    let bytes = 0;
    let firstSentAt = now;
    let lastSentAt = now;
    while (this.acked < count) {
      const frame = this.inFlight.shift();
      if (frame === undefined) break;
      bytes += frame.bytes;
      firstSentAt = Math.min(firstSentAt, frame.sentAt);
      lastSentAt = frame.sentAt;
      this.acked += 1;
    }
    this.inFlightBytes -= bytes;
    this.minRoundTrip = Math.min(this.minRoundTrip, now - lastSentAt);
    this.measure(bytes, firstSentAt, now);
    // With nothing on the way the link sits idle, and idle time is not its speed: the next sample starts afresh.
    if (this.inFlight.length === 0 && this.waitingCount === 0) this.sample = null;
    this.pump();
  }

  /** The socket is gone: what waits is dropped. The page asks again for what it still lacks. */
  close(): void {
    this.closed = true;
    this.ordered.length = 0;
    this.bulk.length = 0;
    this.inFlight.length = 0;
    this.inFlightBytes = 0;
  }

  private measure(bytes: number, firstSentAt: number, now: number): void {
    const sample = this.sample ?? { start: firstSentAt, bytes: 0 };
    sample.bytes += bytes;
    const elapsed = now - sample.start;
    if (elapsed < SAMPLE_MS) {
      this.sample = sample;
      return;
    }
    const speed = sample.bytes / elapsed;
    this.speed = this.speed === null ? speed : this.speed * (1 - SPEED_WEIGHT) + speed * SPEED_WEIGHT;
    this.sample = { start: now, bytes: 0 };
  }

  private pump(): void {
    for (;;) {
      const ordered = this.ordered[0];
      if (ordered !== undefined) {
        if (ordered.paced && !this.fits(ordered.text)) return;
        this.ordered.shift();
        if (ordered.paced) this.launch(ordered.text);
        else this.socket.send(ordered.text);
        continue;
      }
      const bulk = this.bulk[0];
      if (bulk === undefined || !this.fits(bulk)) return;
      this.bulk.shift();
      this.launch(bulk);
    }
  }

  /** Whether a frame may go now. One always goes while nothing is on the way, so a frame larger than the window still leaves. */
  private fits(text: string): boolean {
    return this.inFlightBytes === 0 || this.inFlightBytes + text.length <= this.window;
  }

  /** Sends a frame the page acks, and counts it as on its way. */
  private launch(text: string): void {
    this.inFlight.push({ bytes: text.length, sentAt: this.now() });
    this.inFlightBytes += text.length;
    this.sent += 1;
    this.socket.send(text);
  }
}
