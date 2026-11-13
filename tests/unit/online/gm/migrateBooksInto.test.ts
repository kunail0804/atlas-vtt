import type { Plugin } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../../src/app/campaigns/campaignPaths';
import { TABLE_BOOKS_PATH } from '../../../../src/app/campaigns/players/tableBooksFile';
import { TableBooks } from '../../../../src/app/campaigns/players/TableBooks';
import { CampaignPlayers } from '../../../../src/app/campaigns/players/CampaignPlayers';
import { TablePlayers } from '../../../../src/app/campaigns/players/TablePlayers';
import type { TableCampaigns } from '../../../../src/app/online/gm/tableCampaigns.ts';
import { EMPTY_BOOK, type StoredBook } from '../../../../src/app/online/gm/book/bookStore.ts';
import { OnlineFeature } from '../../../../src/app/online/gm/OnlineFeature.ts';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';

const assets = vi.hoisted(() => ({ tokens: [] as { id: string; collection: string; imagePath: string }[] }));
vi.mock('../../../../src/app/services/AssetService', async (importOriginal) => ({
  ...await importOriginal<object>(),
  AssetService: { getInstance: () => ({ getTokenAssets: () => Promise.resolve(assets.tokens) }) },
}));

const FOLDER = `${CAMPAIGNS_FOLDER}/Witherwild`;
const campaignText = `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1 })}\n`;
const bookWith = (count: number): StoredBook => ({ ...EMPTY_BOOK, notes: [{ id: count.toString(16).padStart(24, '0'), title: `Note ${count}`, body: 'Body', at: count }] });

const opened: ReturnType<typeof createInMemoryApp>[] = [];

/** An online feature whose data file holds these old books, as it would have read them. */
async function feature(old: unknown): Promise<{ feature: OnlineFeature; vault: ReturnType<typeof createInMemoryApp>; saved: Record<string, unknown>[] }> {
  const vault = createInMemoryApp({ files: { [`${FOLDER}/campaign.json`]: campaignText } });
  opened.push(vault);
  await CampaignFiles.open(vault.app).load();
  await TableBooks.open(vault.app).whenReady();
  const saved: Record<string, unknown>[] = [];
  const online = new OnlineFeature({ app: vault.app, manifest: { version: '0' } } as unknown as Plugin, { read: () => Promise.resolve(undefined), write: (data: unknown) => { saved.push(data as Record<string, unknown>); return Promise.resolve(); } } as never);
  // What start() reads of the data file.
  const { readBooks } = await import('../../../../src/app/online/gm/book/bookStore.ts');
  (online as unknown as { legacyBooks: unknown }).legacyBooks = readBooks(old);
  return { feature: online, vault, saved };
}

afterEach(() => {
  for (const vault of opened.splice(0)) {
    TableBooks.release(vault.app);
    TablePlayers.release(vault.app);
    CampaignPlayers.release(vault.app);
    CampaignFiles.release(vault.app);
  }
  vi.restoreAllMocks();
});

describe('carrying the old books into the table\'s books file when a table starts', () => {
  const OLD = { Cairn: { 'art/a.webp': bookWith(1), 'art/gone.webp': bookWith(2) } };

  it('saves the data file without the books it carried over, and with those no library token takes over', async () => {
    assets.tokens = [{ id: 'lib-a', collection: 'Cairn', imagePath: 'art/a.webp' }];
    const { feature: online, vault, saved } = await feature(OLD);
    await online.migrateBooksInto();
    expect(Object.keys(JSON.parse(vault.files.get(TABLE_BOOKS_PATH) ?? '{"books":{}}').books)).toEqual(['lib-a']);
    expect(saved).toHaveLength(1);
    expect(Object.keys((saved[0]?.books ?? {}) as object)).toEqual(['Cairn']);
    expect(Object.keys(((saved[0]?.books as Record<string, object>).Cairn))).toEqual(['art/gone.webp']);
  });

  it('saves the data file without any books once all of them were carried over', async () => {
    assets.tokens = [{ id: 'lib-a', collection: 'Cairn', imagePath: 'art/a.webp' }, { id: 'lib-g', collection: 'Cairn', imagePath: 'art/gone.webp' }];
    const { feature: online, saved } = await feature(OLD);
    await online.migrateBooksInto();
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty('books');
  });

  it('leaves the data file alone when no library token takes any of its books over', async () => {
    assets.tokens = [];
    const { feature: online, saved } = await feature(OLD);
    await online.migrateBooksInto();
    expect(saved).toEqual([]);
  });

  it('leaves the data file alone, and the books in it, when the table\'s file was not written', async () => {
    assets.tokens = [{ id: 'lib-a', collection: 'Cairn', imagePath: 'art/a.webp' }];
    const { feature: online, vault, saved } = await feature(OLD);
    vi.spyOn(vault.app.vault, 'create').mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await online.migrateBooksInto();
    expect(saved).toEqual([]);
    expect(Object.keys((online as unknown as { legacyBooks: Record<string, object> }).legacyBooks.Cairn ?? {})).toEqual(['art/a.webp', 'art/gone.webp']);
  });

  it('are in the table\'s file before a table runs, so no book a player writes there meets the old one', async () => {
    assets.tokens = [{ id: 'lib-a', collection: 'Cairn', imagePath: 'art/a.webp' }];
    const { feature: online, vault } = await feature(OLD);
    CampaignPlayers.open(vault.app);
    TablePlayers.open(vault.app);
    const campaigns = (online as unknown as { campaigns(): TableCampaigns }).campaigns();
    expect(await campaigns.open('c1')).not.toBeNull();
    expect(Object.keys(JSON.parse(vault.files.get(TABLE_BOOKS_PATH) ?? '{"books":{}}').books)).toEqual(['lib-a']);
  });
});
