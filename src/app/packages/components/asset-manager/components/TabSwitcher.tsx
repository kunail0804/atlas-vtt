import React, { useId } from 'react';
import { ChevronDown, Store } from 'lucide-react';
import type { Tab } from '../types';
import { tabs, getTabDisplayName } from '../types';
import { HeaderMenu } from './HeaderMenu';
import { LabelTooltip } from '../../primitives/tooltip';
import { modShortcut } from '../utils/modShortcut';
import { Skeleton } from '../../primitives/Skeleton';
import { t } from '../../../../i18n';

export interface TabSwitcherProps {
  /** Null while the Armarium is shown: no tab is current, and a tab leads back to the library. */
  activeTab: Tab | null;
  onTabChange: (tab: Tab) => void;
  /** How many assets each tab holds; null while they are being counted. */
  assetCounts: Record<Tab, number> | null;
  /** The collection could not be loaded: no count is coming, so none is shown or awaited. */
  countsFailed?: boolean;
  /** Shows the Armarium, the strip's last place, set apart from the library's tabs; without it the strip has none. */
  onShowArmarium?: (() => void) | undefined;
  /** The compendium, shown after the asset types; while it is open no asset type is current. */
  compendium?: { open: boolean; onOpen: () => void } | undefined;
}

/**
 * A tab's count: how many assets the collection holds in it, never what a search or filters leave, so the tabs keep
 * their width whatever the list shows. Its placeholder while the collection is being counted: never a wrong 0. A
 * collection that could not be loaded has no count to wait for, so its place stays empty and still.
 */
function TabCount({ count, failed }: { count: number | undefined; failed: boolean }): React.JSX.Element {
  if (count === undefined) return <span className="atlas-tab-count">{failed ? null : <Skeleton shape="text" live />}</span>;
  return <span className="atlas-tab-count">{count}</span>;
}

/**
 * The asset type tabs, then the compendium where it is offered, and after them the Armarium, a place beside the library, as its icon alone (the folded menu names it). Wide headers show them side by side;
 * narrow ones show the current place as a menu button instead (the toolbar's `data-compact` steps pick one), so the
 * toolbar stays a single row.
 */
export function TabSwitcher({ activeTab, onTabChange, assetCounts, countsFailed = false, onShowArmarium, compendium }: TabSwitcherProps): React.JSX.Element {
  const labelId = useId();
  const compendiumOpen = compendium?.open === true;
  const armariumShown = activeTab === null && !compendiumOpen;
  const current = compendiumOpen ? null : activeTab;
  const activeName = compendiumOpen ? t('compendium.browser.tab') : activeTab ? getTabDisplayName(activeTab) : t('armarium.title');

  return (
    <>
      <nav className="atlas-asset-manager-tabs" aria-labelledby={labelId}>
        <span id={labelId} hidden>{t('am.tabs.assetType')}</span>
        {tabs.map((tab, index) => (
          <LabelTooltip key={tab} label={getTabDisplayName(tab)} shortcut={modShortcut(String(index + 1)).label} describe>
            <button
              type="button"
              className={`atlas-tab-button ${current === tab ? 'atlas-active' : ''}`}
              onClick={() => onTabChange(tab)}
              aria-current={current === tab ? 'page' : undefined}
              aria-keyshortcuts={modShortcut(String(index + 1)).aria}
            >
              <span className="atlas-tab-label">{getTabDisplayName(tab)}</span>
              <TabCount count={assetCounts?.[tab]} failed={countsFailed} />
            </button>
          </LabelTooltip>
        ))}
        {compendium && (
          <button
            type="button"
            className={`atlas-tab-button atlas-tab-button--compendium ${compendiumOpen ? 'atlas-active' : ''}`}
            onClick={compendium.onOpen}
            aria-current={compendiumOpen ? 'page' : undefined}
          >
            <span className="atlas-tab-label">{t('compendium.browser.tab')}</span>
          </button>
        )}
        {onShowArmarium && (
          <>
            <span className="atlas-tab-divider" aria-hidden />
            <LabelTooltip label={t('armarium.page')} describe>
              <button
                type="button"
                className={`atlas-tab-button atlas-tab-button--icon ${armariumShown ? 'atlas-active' : ''}`}
                onClick={onShowArmarium}
                aria-label={t('armarium.title')}
                aria-current={armariumShown ? 'page' : undefined}
              >
                <Store />
              </button>
            </LabelTooltip>
          </>
        )}
      </nav>

      <HeaderMenu
        className="atlas-am-tab-menu"
        label={t('am.tabs.current', { name: activeName })}
        triggerClassName="atlas-am-tab-menu-trigger"
        align="center"
        triggerContent={
          <>
            <span className="atlas-tab-label">{activeName}</span>
            {current && <TabCount count={assetCounts?.[current]} failed={countsFailed} />}
            <ChevronDown className="atlas-am-tab-menu-chevron" />
          </>
        }
        items={[
          ...tabs.map((tab) => ({
            key: tab,
            label: getTabDisplayName(tab),
            ...(assetCounts ? { detail: assetCounts[tab] } : {}),
            checked: tab === current,
            onSelect: () => onTabChange(tab),
          })),
          ...(compendium ? [{ key: 'compendium', label: t('compendium.browser.tab'), checked: compendiumOpen, separated: true, onSelect: compendium.onOpen }] : []),
          ...(onShowArmarium ? [{ key: 'armarium', label: t('armarium.title'), separated: true, checked: armariumShown, onSelect: onShowArmarium }] : []),
        ]}
      />
    </>
  );
}
