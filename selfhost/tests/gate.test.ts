import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { JoinGate } from '../relay/gate.ts';

/** A socket that is open and keeps nothing: the gate only sends to it and watches it close. */
function openSocket(): WebSocket {
  return { OPEN: 1, CONNECTING: 0, readyState: 1, send: vi.fn(), close: vi.fn(), on: vi.fn() } as unknown as WebSocket;
}

describe('the join gate tells the GM of a seat asked back', () => {
  afterEach(() => vi.useRealTimers());

  function gate(connected: Set<string>): { gate: JoinGate; toGm: ReturnType<typeof vi.fn> } {
    vi.useFakeTimers();
    const toGm = vi.fn();
    const joinGate = new JoinGate({ codeHash: null, ask: false }, { toGm, changed: vi.fn(), seatConnected: (seat) => connected.has(seat) });
    return { gate: joinGate, toGm };
  }

  it('says whether that seat has a page connected when the knock comes, and again in the welcome', () => {
    const connected = new Set(['mira']);
    const { gate: joinGate, toGm } = gate(connected);
    joinGate.knock(openSocket(), 'Mira', 'mira', false, 'a');
    joinGate.knock(openSocket(), 'Ana', 'ana', false, 'b');
    joinGate.knock(openSocket(), 'Dora', null, false, 'c');
    const knocks = toGm.mock.calls.map(([frame]) => frame as Record<string, unknown>);
    expect(knocks.map(({ name, reclaim, seatConnected }) => ({ name, reclaim, seatConnected }))).toEqual([
      { name: 'Mira', reclaim: true, seatConnected: true },
      { name: 'Ana', reclaim: true, seatConnected: undefined },
      { name: 'Dora', reclaim: undefined, seatConnected: undefined },
    ]);
    // A GM who comes back is told the seats as they are then.
    connected.delete('mira');
    connected.add('ana');
    expect(joinGate.waiting().map(({ name, seatConnected }) => ({ name, seatConnected }))).toEqual([
      { name: 'Mira', seatConnected: undefined },
      { name: 'Ana', seatConnected: true },
      { name: 'Dora', seatConnected: undefined },
    ]);
    joinGate.closeAll(1000);
  });
});
