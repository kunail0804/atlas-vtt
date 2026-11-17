import React from 'react';
import type { App } from 'obsidian';
import { showHostedDialog } from '../statblocks/editor/hostedDialog';
import { CompendiumLibraryDialog } from '../react/components/dashboard/compendium/CompendiumLibraryDialog';

/** The vault's compendium sources from outside a dialog of Atlas (the command "Manage compendium sources"). */
export function openCompendiumLibrary(app: App, doc: Document = activeDocument): void {
  showHostedDialog(doc, 'atlas-compendium-library-host', (close) => <CompendiumLibraryDialog key="library" app={app} onClose={close} />);
}
