import { MAX_PARTS, parseGmMessage, type GmMessage } from '../../../src/app/online/protocol/game.ts';
import type { DeltaOf } from '../../../src/app/online/protocol/delta.ts';
import { DeltaReader } from '../../../src/app/online/protocol/deltaReader.ts';

/** Messages being put together from parts at once; an older one is dropped for a newer. */
const MAX_OPEN_MESSAGES = 8;

interface OpenMessage {
  readonly count: number;
  readonly pieces: (string | undefined)[];
  received: number;
}

function base64Bytes(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/**
 * Everything the GM sends the player, read as the plugin writes it: large messages come in parts,
 * `tokens`, `fog` and `sight` come whole then as deltas. A delta that does not follow is a gap: the
 * page asks the GM for the whole message again.
 */
export class GameInbox {
  private readonly reader = new DeltaReader();
  private readonly open = new Map<string, OpenMessage>();
  private readonly deliver: (message: GmMessage) => void;
  private readonly resync: (scene: string, of: DeltaOf) => void;

  constructor(deliver: (message: GmMessage) => void, resync: (scene: string, of: DeltaOf) => void) {
    this.deliver = deliver;
    this.resync = resync;
  }

  receive(body: unknown): void {
    const message = parseGmMessage(body);
    if (message === null) return;
    if (message.t === 'part') {
      this.piece(message.id, message.index, message.count, message.data);
      return;
    }
    const read = this.reader.read(message);
    if (read === 'gap') {
      if (message.t === 'delta') this.resync(message.scene, message.of);
      return;
    }
    if (read !== null) this.deliver(read);
  }

  private piece(id: string, index: number, count: number, data: string): void {
    if (count > MAX_PARTS || index >= count) return;
    let open = this.open.get(id);
    if (open === undefined) {
      if (this.open.size >= MAX_OPEN_MESSAGES) {
        const oldest = this.open.keys().next().value;
        if (oldest !== undefined) this.open.delete(oldest);
      }
      open = { count, pieces: new Array<string | undefined>(count).fill(undefined), received: 0 };
      this.open.set(id, open);
    }
    if (open.count !== count || open.pieces[index] !== undefined) return;
    open.pieces[index] = data;
    open.received += 1;
    if (open.received < open.count) return;
    this.open.delete(id);
    const parts = open.pieces.map((piece) => base64Bytes(piece ?? ''));
    const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      whole.set(part, offset);
      offset += part.length;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(whole));
    } catch {
      return;
    }
    this.receive(value);
  }
}
