import React from 'react';
import { DEV_BUILD } from '../../../devBuild';

/** A pill under the GM's scene tabs naming the dev image this plugin came from; nothing on other builds. */
export function DevBuildBadge(): React.ReactElement | null {
  if (DEV_BUILD === null) return null;
  return <span className="atlas-dev-build-badge">DEV · {DEV_BUILD}</span>;
}
