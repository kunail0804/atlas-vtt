import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AssetManager from '../../src/app/packages/components/asset-manager/AssetManager';
import type { AnyAsset, Tab } from '../../src/app/packages/components/asset-manager/types';

const GOBLIN: AnyAsset = { id: 'goblin', name: 'Goblin', type: 'tokens', imageUrl: '', folderId: null, modifiedAt: 0 };
const workspaceApp = { workspace: { on: () => ({}), offref: () => {} } };

vi.mock('../../src/app/packages/components/asset-manager/hooks/useAssetData', () => ({
  useAssetData: () => ({
    shownFolderOf: (folderId: string | null) => folderId,
    folders: [], collections: [], availableTags: [], assets: [GOBLIN], assetsLoading: false,
    assetCounts: null, app: workspaceApp,
  }),
}));
vi.mock('../../src/app/packages/components/asset-manager/hooks/useAssetCrud', () => ({ useAssetCrud: () => ({}) }));
vi.mock('../../src/app/packages/components/asset-manager/hooks/useTagsAndCollections', () => ({ useTagsAndCollections: () => ({}) }));
vi.mock('../../src/app/packages/components/asset-manager/hooks/useContextMenus', () => ({ useContextMenus: () => ({}) }));
vi.mock('../../src/app/packages/components/asset-manager/hooks/useStatblockLink', () => ({ useStatblockLink: () => ({}) }));
vi.mock('../../src/app/packages/components/asset-manager/hooks/useRememberedPlace', () => ({
  useRememberedPlace: () => ({ scrollTopOf: () => 0, setScrollTop: () => {} }),
}));
const effects = vi.hoisted(() => ({ last: null as null | { compendiumDialogOpen?: boolean } }));
vi.mock('../../src/app/packages/components/asset-manager/hooks/useAssetManagerEffects', () => ({
  useAssetManagerEffects: (deps: { compendiumDialogOpen?: boolean }) => { effects.last = deps; },
}));
vi.mock('../../src/app/packages/components/asset-manager/components/Sidebar', () => ({ Sidebar: () => <aside>Collections</aside> }));
vi.mock('../../src/app/packages/components/asset-manager/components/ModalLayer', () => ({ ModalLayer: () => null }));
vi.mock('../../src/app/packages/components/asset-manager/components/Header', () => ({
  Header: ({ onOpenCompendium }: { onOpenCompendium: () => void }) => <button onClick={onOpenCompendium}>Open compendium</button>,
}));
vi.mock('../../src/app/packages/components/asset-manager/components/Content', () => ({
  Content: ({ activeTab, assets }: { activeTab: Tab; assets: AnyAsset[] }) => (
    <ul aria-label={activeTab}>{assets.map((asset) => <li key={asset.id}>{asset.name}</li>)}</ul>
  ),
}));
vi.mock('../../src/app/packages/components/asset-manager/compendium/CompendiumPane', () => ({
  CompendiumPane: ({ tabs, onDialogChange }: { tabs: React.ReactNode; onDialogChange: (open: boolean) => void }) => (
    <section aria-label="Compendium pane">
      {tabs}
      <button onClick={() => onDialogChange(true)}>Open a dialog</button>
    </section>
  ),
}));

afterEach(cleanup);

it('shows the compendium in place of the assets, and an asset type brings the assets back', () => {
  render(<AssetManager isOpen onClose={() => {}} />);
  expect(screen.getByRole('list', { name: 'tokens' }).textContent).toBe('Goblin');

  fireEvent.click(screen.getByRole('button', { name: 'Open compendium' }));
  const pane = screen.getByRole('region', { name: 'Compendium pane' });
  expect(screen.queryByRole('list', { name: 'tokens' })).toBeNull();
  expect(screen.queryByText('Collections')).toBeNull();
  // The tabs in the compendium's toolbar: Compendium current, no asset type.
  expect(screen.getByRole('button', { name: 'Compendium' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: /^Characters|^Tokens/ }).getAttribute('aria-current')).toBeNull();
  expect(pane).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Open a dialog' }));
  expect(effects.last?.compendiumDialogOpen).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: /^Maps/ }));
  expect(screen.queryByRole('region', { name: 'Compendium pane' })).toBeNull();
  expect(screen.getByRole('list', { name: 'maps' })).toBeTruthy();
  expect(effects.last?.compendiumDialogOpen).toBe(false);
});
