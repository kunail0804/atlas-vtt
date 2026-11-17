import React from 'react';
import type { BookChoice } from '../../../../compendium/sourceTree';
import { t } from '../../../../i18n';

/** An installed book's tag: installed, or an update available. */
export function BookStateTag({ book }: { book: BookChoice }): React.JSX.Element {
  const outdated = book.state.kind === 'outdated';
  return <span className={`atlas-csm-tag${outdated ? ' atlas-csm-tag--accent' : ''}`}>{outdated ? t('compendium.outdated') : t('compendium.installed')}</span>;
}
