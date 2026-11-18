import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const FILE = `${CAMPAIGNS_FOLDER}/Witherwild/campaign.json`;
const campaignText = `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1 })}\n`;

const opened: ReturnType<typeof createInMemoryApp>[] = [];

async function campaigns(): Promise<{ vault: ReturnType<typeof createInMemoryApp>; files: CampaignFiles }> {
  const vault = createInMemoryApp({ files: { [FILE]: campaignText } });
  opened.push(vault);
  const files = CampaignFiles.open(vault.app);
  await files.load();
  return { vault, files };
}

afterEach(() => {
  for (const vault of opened.splice(0)) CampaignFiles.release(vault.app);
  vi.restoreAllMocks();
});

describe('RecordFiles.save', () => {
  it('rejects when the write fails, logs it, and the writes after it still go through', async () => {
    const { vault, files } = await campaigns();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(vault.app.vault.process).mockRejectedValueOnce(new Error('disk full'));

    await expect(files.save('c1', (stored) => ({ ...stored, description: 'lost' }))).rejects.toThrow('disk full');
    expect(logged).toHaveBeenCalledOnce();

    await files.save('c1', (stored) => ({ ...stored, description: 'kept' }));
    expect(JSON.parse(vault.files.get(FILE)!)).toMatchObject({ description: 'kept' });
  });

  it('leaves update as it was: a failed write is logged and settles the queue', async () => {
    const { vault, files } = await campaigns();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(vault.app.vault.process).mockRejectedValueOnce(new Error('disk full'));

    files.update('c1', (stored) => ({ ...stored, description: 'lost' }));
    await expect(files.flush()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledOnce();
  });

  it('puts the record back as it was in memory when the write fails', async () => {
    const { vault, files } = await campaigns();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(vault.app.vault.process).mockRejectedValueOnce(new Error('disk full'));
    const before = files.entries()[0];

    await expect(files.save('c1', (stored) => ({ ...stored, sources: ['dnd5e-2024/srd-5.2.1'] }))).rejects.toThrow('disk full');
    expect(files.entries()[0]).toBe(before);
    expect(files.entries()[0]).not.toHaveProperty('sources');
  });

  it('leaves a later change in memory when an earlier write fails', async () => {
    const { vault, files } = await campaigns();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(vault.app.vault.process).mockRejectedValueOnce(new Error('disk full'));

    const failed = files.save('c1', (stored) => ({ ...stored, description: 'lost' }));
    const kept = files.save('c1', (stored) => ({ ...stored, name: 'Moor' }));
    await expect(failed).rejects.toThrow('disk full');
    await kept;
    expect(files.entries()[0]).toMatchObject({ name: 'Moor' });
    expect(JSON.parse(vault.files.get(`${CAMPAIGNS_FOLDER}/Moor/campaign.json`)!)).not.toHaveProperty('description');
  });
});
