import { describe, expect, it, vi } from 'vitest';
import { CompendiumShare, pageIdOf, type CompendiumSharePorts, type PlayerShare } from '../../../../../src/app/online/gm/compendium/CompendiumShare';
import { pageEditParts, parseGmMessage, type GmMessage, type PageEdit } from '../../../../../src/app/online/protocol/index';

const FIRE = 'Compendium/X/Spells/Fireball.md';
const WOLF = 'Compendium/X/Monsters/Wolf.md';
const KEY = 'k'.repeat(43);

function harness(): {
  share: CompendiumShare;
  sent: Array<{ body: GmMessage; to: string }>;
  shares: Map<string, PlayerShare[]>;
  write: ReturnType<typeof vi.fn<(path: string, edit: PageEdit, allowed: readonly string[]) => Promise<boolean>>>;
} {
  const sent: Array<{ body: GmMessage; to: string }> = [];
  const shares = new Map<string, PlayerShare[]>([['alice', [{ path: FIRE, access: 'read' }, { path: WOLF, access: 'write' }]]]);
  const write = vi.fn(async () => true);
  let clock = 0;
  const ports: CompendiumSharePorts = {
    send: (body, to) => sent.push({ body, to }),
    nameOf: () => 'Alice',
    identify: async (key) => (key === KEY ? 'alice' : null),
    sharesOf: (id) => shares.get(id) ?? [],
    describe: (path) => ({ title: path === FIRE ? 'Fireball' : 'Wolf', kind: path === FIRE ? 'spell' : 'monster' }),
    read: async (path) => ({
      title: path === FIRE ? 'Fireball' : 'Wolf', kind: path === FIRE ? 'spell' : 'monster',
      content: { rows: [{ label: 'Level', value: '3' }], sections: [], text: 'A bright streak.' },
      fields: [{ key: 'level', label: 'Level', value: '3' }],
    }),
    write,
    now: () => (clock += 1000),
  };
  return { share: new CompendiumShare(ports), sent, shares, write };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('the compendium pages shared at a table', () => {
  it('sends a player who says who they are the list of their pages, never the notes\' paths', async () => {
    const { share, sent } = harness();
    expect(share.receive('r1', { t: 'identify', key: KEY })).toBe(true);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('r1');
    expect(sent[0]?.body).toEqual({ t: 'compendium', pages: [
      { id: pageIdOf(FIRE), title: 'Fireball', kind: 'spell', access: 'read' },
      { id: pageIdOf(WOLF), title: 'Wolf', kind: 'monster', access: 'write' },
    ] });
    expect(JSON.stringify(sent)).not.toContain('Compendium/');
    // What the GM sends, the player's page reads.
    expect(parseGmMessage(JSON.parse(JSON.stringify(sent[0]?.body)))).toEqual(sent[0]?.body);
  });

  it('sends nothing to a player who has not said who they are, or whose key is refused', async () => {
    const { share, sent } = harness();
    share.receive('r1', { t: 'compendium-open', id: pageIdOf(FIRE) });
    share.receive('r2', { t: 'identify', key: 'x'.repeat(43) });
    await flush();
    expect(sent).toEqual([]);
  });

  it('opens a page with its properties to change only where the player may write', async () => {
    const { share, sent } = harness();
    share.receive('r1', { t: 'identify', key: KEY });
    await flush();
    share.receive('r1', { t: 'compendium-open', id: pageIdOf(FIRE) });
    share.receive('r1', { t: 'compendium-open', id: pageIdOf(WOLF) });
    await flush();
    const pages = sent.filter((entry) => entry.body.t === 'compendium-entry').map((entry) => entry.body);
    expect(pages.map((page) => (page.t === 'compendium-entry' ? [page.page.title, page.page.fields] : null))).toEqual([
      ['Fireball', undefined],
      ['Wolf', [{ key: 'level', label: 'Level', value: '3' }]],
    ]);
  });

  it('writes a change sent in parts, and refuses one to a page the player may only read', async () => {
    const { share, sent, write } = harness();
    share.receive('r1', { t: 'identify', key: KEY });
    await flush();
    const change: PageEdit = { fields: { level: '4' }, text: 'Bigger. '.repeat(300) };
    const parts = pageEditParts(pageIdOf(WOLF), 'e1', change);
    expect(parts?.length).toBeGreaterThan(1);
    for (const part of parts ?? []) share.receive('r1', part);
    await flush();
    expect(write).toHaveBeenCalledWith(WOLF, change, ['level']);
    expect(sent.at(-1)?.body).toEqual({ t: 'compendium-saved', id: pageIdOf(WOLF), ok: true });

    for (const part of pageEditParts(pageIdOf(FIRE), 'e2', change) ?? []) share.receive('r1', part);
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(sent.some((entry) => entry.body.t === 'compendium-saved' && entry.body.id === pageIdOf(FIRE) && !entry.body.ok)).toBe(true);
  });

  it('follows the GM\'s changes: a page taken back leaves the list, a new access sends the open page again', async () => {
    const { share, sent, shares } = harness();
    share.receive('r1', { t: 'identify', key: KEY });
    await flush();
    share.receive('r1', { t: 'compendium-open', id: pageIdOf(FIRE) });
    await flush();
    sent.length = 0;
    shares.set('alice', [{ path: FIRE, access: 'write' }]);
    share.sharesChanged();
    await flush();
    expect(sent.map((entry) => entry.body.t)).toEqual(['compendium', 'compendium-entry']);
    const entry = sent[1]?.body;
    expect(entry?.t === 'compendium-entry' && entry.page.access).toBe('write');

    sent.length = 0;
    shares.set('alice', []);
    share.sharesChanged();
    await flush();
    expect(sent.map((item) => item.body)).toEqual([{ t: 'compendium', pages: [] }]);
    // Taken back: opening it is refused.
    share.receive('r1', { t: 'compendium-open', id: pageIdOf(FIRE) });
    await flush();
    expect(sent).toHaveLength(1);
  });
});
