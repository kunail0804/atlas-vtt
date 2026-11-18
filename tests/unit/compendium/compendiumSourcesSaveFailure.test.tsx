// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CampaignService } from '../../../src/app/campaigns/CampaignService';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import type { Campaign } from '../../../src/app/campaigns/campaignTypes';
import { CompendiumSourcesDialog } from '../../../src/app/react/components/dashboard/compendium/CompendiumSourcesDialog';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const FILE = `${CAMPAIGNS_FOLDER}/Witherwild/campaign.json`;
const campaignText = `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1, sources: ['dnd5e-srd'] })}\n`;

const opened: ReturnType<typeof createInMemoryApp>[] = [];

async function dialog(): Promise<{ vault: ReturnType<typeof createInMemoryApp>; onClose: () => void }> {
  const vault = createInMemoryApp({ files: { [FILE]: campaignText } });
  opened.push(vault);
  const files = CampaignFiles.open(vault.app);
  await files.load();
  const service = new CampaignService(files);
  const campaign = service.get('c1') as Campaign;
  const onClose = vi.fn();
  render(<CompendiumSourcesDialog app={vault.app} campaign={campaign} service={service} onClose={onClose} />);
  return { vault, onClose };
}

const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' });

afterEach(() => {
  cleanup();
  for (const vault of opened.splice(0)) CampaignFiles.release(vault.app);
  vi.restoreAllMocks();
});

describe('saving the compendium sources of a campaign', () => {
  it('tells the GM in the dialog when the campaign file cannot be written, and stays open', async () => {
    const { vault, onClose } = await dialog();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(vault.app.vault.process).mockRejectedValueOnce(new Error('disk full'));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not save the sources of this world: disk full');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once the campaign file is written', async () => {
    const { onClose } = await dialog();
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
