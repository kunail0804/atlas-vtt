import type { ExperimentalFeatureId } from './experimentalFeatures';

/**
 * Upstream's experimental features this fork ships switched on: the statblock editor is the engine of
 * its character sheets. They are on whatever the settings say and never offered on the page.
 */
export const FORK_ALWAYS_ON: ReadonlySet<ExperimentalFeatureId> = new Set<ExperimentalFeatureId>(['statblockEditor']);
