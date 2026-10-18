// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DND5E_2024 } from '../../../../src/app/characterSheets/dnd5e2024.ts';
import { applySheetEdit, newSheet, type SheetEdit } from '../../../../src/app/characterSheets/sheetNote.ts';
import type { SheetValues } from '../../../../src/app/characterSheets/sheetFields.ts';
import type { GmMessage } from '../../../../src/app/online/protocol/index.ts';
import { SheetShare, type ReadSheet } from '../../../../src/app/online/gm/book/SheetShare.ts';

const ANA = 'a'.repeat(20);
const BEN = 'b'.repeat(20);
const MIRA = 'Personnages/Mira.md';
const LORE = 'Lore/Famille.md';
const TEXT_HASH = 'f'.repeat(64);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A table with Ana playing Mira, whose note holds a sheet and links one note; the note is a value the test changes. */
function table(): { share: SheetShare; sent: { body: GmMessage; to: string }[]; writes: SheetEdit[]; note: { values: SheetValues; refuse: boolean } } {
  const sent: { body: GmMessage; to: string }[] = [];
  const writes: SheetEdit[] = [];
  const note = { values: { ...newSheet(DND5E_2024, 'Mira'), level: 3 }, refuse: false };
  let now = 0;
  const share = new SheetShare({
    send: (body, to) => void sent.push({ body, to }),
    now: () => (now += 1000),
    setTimer: () => 0,
    clearTimer: () => undefined,
    online: () => [ANA, BEN],
    noteOf: (player) => (player === ANA ? MIRA : null),
    read: async (path): Promise<ReadSheet | null> => (path !== MIRA ? null : {
      sheet: { system: 'dnd5e-2024', values: note.values },
      notes: [{ title: 'Famille', body: 'Le début…', text: { hash: TEXT_HASH, size: 5, mime: 'text/markdown' } }],
      paths: [LORE],
      texts: new Map([[TEXT_HASH, new TextEncoder().encode('Tout.') as Uint8Array<ArrayBuffer>]]),
      images: new Map(),
    }),
    write: async (_path, edit) => {
      writes.push(edit);
      if (note.refuse) return false;
      note.values = applySheetEdit(DND5E_2024, note.values, edit) ?? note.values;
      return true;
    },
    readImage: async () => null,
  });
  return { share, sent, writes, note };
}

const sheetsTo = (sent: readonly { body: GmMessage; to: string }[], to: string): Extract<GmMessage, { t: 'sheet' }>[] => sent.flatMap(({ body, to: who }) => (body.t === 'sheet' && who === to ? [body] : []));

describe('players\' character sheets', () => {
  it('go to each player with their character\'s sheet and notes, and none to one who plays no sheet', async () => {
    const { share, sent } = table();
    share.start();
    await settle();
    expect(sheetsTo(sent, ANA).at(-1)).toMatchObject({ sheet: { system: 'dnd5e-2024', values: { name: 'Mira', level: 3 } }, notes: [{ title: 'Famille' }] });
    expect(sheetsTo(sent, BEN).at(-1)).toEqual({ t: 'sheet', sheet: null, notes: [] });
    share.update();
    await settle();
    expect(sheetsTo(sent, ANA)).toHaveLength(1);
  });

  it('go again when the note or a linked note changes, and only then', async () => {
    const { share, sent, note } = table();
    share.start();
    await settle();
    share.noteChanged(LORE);
    await settle();
    expect(sheetsTo(sent, ANA)).toHaveLength(1);
    note.values = { ...note.values, level: 4 };
    share.noteChanged(MIRA);
    await settle();
    expect(sheetsTo(sent, ANA).at(-1)?.sheet?.values.level).toBe(4);
  });

  it('take a player\'s edit into the note, and answer a refused one with the sheet as kept', async () => {
    const { share, sent, writes, note } = table();
    share.start();
    await settle();
    expect(share.receive(ANA, { t: 'sheet-edit', key: 'level', value: 5 })).toBe(true);
    await settle();
    expect(writes).toEqual([{ op: 'set', key: 'level', value: 5 }]);
    expect(note.values.level).toBe(5);
    note.refuse = true;
    const before = sheetsTo(sent, ANA).length;
    share.noteChanged(MIRA);
    await settle();
    share.receive(ANA, { t: 'sheet-row', key: 'equipment', index: 0, row: { name: 'Corde' } });
    await settle();
    await settle();
    expect(sheetsTo(sent, ANA).length).toBeGreaterThanOrEqual(before + 1);
    // A player without a sheet writes nothing.
    share.receive(BEN, { t: 'sheet-edit', key: 'level', value: 2 });
    await settle();
    expect(writes).toHaveLength(2);
  });

  it('serve a linked note\'s whole text to its player alone', async () => {
    const { share, sent } = table();
    share.start();
    await settle();
    expect(share.receive(BEN, { t: 'asset-request', hash: TEXT_HASH })).toBe(false);
    expect(share.receive(ANA, { t: 'asset-request', hash: TEXT_HASH })).toBe(true);
    await settle();
    const chunk = sent.find(({ body, to }) => body.t === 'asset-chunk' && to === ANA)?.body as { data: string } | undefined;
    expect(Buffer.from(chunk?.data ?? '', 'base64').toString()).toBe('Tout.');
  });
});
