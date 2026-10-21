import { describe, expect, it } from 'vitest';
import { CampaignService } from '../../../src/app/campaigns/CampaignService';
import { parseCampaign } from '../../../src/app/campaigns/campaignValidation';
import { memoryCampaigns } from '../../mocks/memoryCampaigns';

describe('a campaign\'s compendium sources', () => {
  it('are read as source ids, each once, without anything else', () => {
    expect(parseCampaign({ id: 'c', name: 'X', sources: ['dnd5e-2014/srd-5.1', 'dnd5e-2014/srd-5.1', 'nope', 7, '../x'] })?.sources).toEqual(['dnd5e-2014/srd-5.1']);
    expect(parseCampaign({ id: 'c', name: 'X', sources: ['nope'] })).not.toHaveProperty('sources');
    expect(parseCampaign({ id: 'c', name: 'X', sources: 'dnd5e-2014/srd-5.1' })).not.toHaveProperty('sources');
  });

  it('are saved by the campaign settings, and an empty list removes the field', () => {
    const storage = memoryCampaigns();
    const service = new CampaignService(storage);
    const { id } = service.create('Witherwild', 1);
    service.update(id, { sources: ['dnd5e-2024/srd-5.2.1', 'dnd5e-2024/tasha'] });
    expect(service.get(id)?.sources).toEqual(['dnd5e-2024/srd-5.2.1', 'dnd5e-2024/tasha']);
    service.update(id, { sources: [] });
    expect(storage.current()[0]).not.toHaveProperty('sources');
    expect(() => service.update(id, { sources: ['not a source'] })).toThrow(/compendium sources/);
  });
});
