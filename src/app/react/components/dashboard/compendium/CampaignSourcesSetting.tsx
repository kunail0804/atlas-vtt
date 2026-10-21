import React, { useId, useState } from 'react';
import type { App } from 'obsidian';
import { AnimatePresence } from 'framer-motion';
import type { Campaign } from '../../../../campaigns/campaignTypes';
import type { CampaignService } from '../../../../campaigns/CampaignService';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { t } from '../../../../i18n';
import { GameIcon } from '../../GameIcon';
import { DASHBOARD_ICON_PATHS } from '../../../../types/dashboardIconPaths';
import { CompendiumSourcesDialog } from './CompendiumSourcesDialog';
import { useInstalledSources } from './useInstalledSources';

interface CampaignSourcesSettingProps {
  app: App;
  campaign: Campaign;
  service: CampaignService;
  disabled: boolean;
  /** Opens the picker at once: the campaign was just created. */
  openAtStart: boolean;
}

/** The campaign's compendium sources on its page: their names, on the button that opens the picker. */
export function CampaignSourcesSetting({ app, campaign, service, disabled, openAtStart }: CampaignSourcesSettingProps): React.JSX.Element {
  const headingId = useId();
  const { sources } = useInstalledSources(app);
  const [isOpen, setIsOpen] = useState(openAtStart && !disabled);
  const nameOf = (id: string): string => {
    const installed = sources?.find((source) => source.manifest.id === id)?.manifest;
    if (installed) return `${installed.system.name} · ${installed.book.name}`;
    const official = OFFICIAL_SOURCES.find((source) => source.id === id);
    return official ? `${official.system.name} · ${official.book.name}` : id;
  };
  const names = (campaign.sources ?? []).map(nameOf);

  return (
    <section className="campaign-system" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-heading">{t('compendium.heading')}</h2>
      <button
        type="button"
        className="campaign-system__trigger"
        aria-labelledby={headingId}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
      >
        <span className={names.length > 0 ? 'campaign-system__name' : 'campaign-system__name is-empty'}>
          {names.length > 0 ? names.join(', ') : t('compendium.none')}
        </span>
        <GameIcon path={DASHBOARD_ICON_PATHS['rule-book']} className="campaign-system__icon" />
      </button>
      <AnimatePresence>
        {isOpen && <CompendiumSourcesDialog app={app} campaign={campaign} service={service} onClose={() => setIsOpen(false)} />}
      </AnimatePresence>
    </section>
  );
}
