import React from 'react';
import type { Tab } from '../types';
import { Button } from '../../primitives/button';
import { t, tPointer } from '../../../../i18n';

/**
 * The tabs a GM fills from the asset manager itself. Player characters are made from tokens, and scenes from maps (a
 * scene is an instance of a map), so neither tab offers to make one of its own.
 */
export type CreatableTab = Exclude<Tab, 'party' | 'scenes'>;

export interface EmptyTabActionProps {
  tab: Tab;
  /** Starts making an asset of the tab, as the header's create menu does. */
  onCreate: Record<CreatableTab, () => void>;
  /** Shows the Maps tab, where scenes are made. */
  onShowMaps: () => void;
}

/** The create menu's words for each tab, so an empty tab offers what the menu does. */
const CREATE_LABEL: Record<CreatableTab, () => string> = {
  tokens: () => t('am.header.createToken'),
  maps: () => t('am.header.addMap'),
  encounters: () => t('am.header.createEncounter'),
};

/**
 * What an empty tab offers: one button that makes its first asset. The Players tab says how a token joins it, and
 * the Scenes tab where scenes come from (a map), with the way there.
 */
export function EmptyTabAction({ tab, onCreate, onShowMaps }: EmptyTabActionProps): React.JSX.Element {
  if (tab === 'party') return <p>{tPointer('am.empty.partyHint')}</p>;
  if (tab === 'scenes') {
    return (
      <>
        <p>{tPointer('am.empty.scenesHint')}</p>
        <Button variant="default" className="atlas-empty-action" onClick={onShowMaps}>{t('am.empty.goToMaps')}</Button>
      </>
    );
  }
  return (
    <Button variant="default" className="atlas-empty-action" onClick={onCreate[tab]}>{CREATE_LABEL[tab]()}</Button>
  );
}
