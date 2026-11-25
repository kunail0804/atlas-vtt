import { AssetService } from '../../../services/AssetService';
import { useAtlasSettings } from '../../../keyboard/useMapHotkeys';
import { SettingsService } from '../../../services/SettingsService';
import React, { useState, useRef, useMemo, useCallback, startTransition } from 'react';
import type { AssetManagerProps, Tab } from './types';

import { Header } from './components/Header';
import type { HeaderMenuHandle } from './components/HeaderMenu';
import { Sidebar } from './components/Sidebar';
import { EmptyTabAction, type CreatableTab } from './components/EmptyTabAction';
import { Content } from './components/Content';
import { LocationBar } from './components/LocationBar';
import { ModalLayer } from './components/ModalLayer';
import { AssetManagerWindow, useOpenedAfterPress } from './components/AssetManagerWindow';
import { AssetManagerTours } from './components/AssetManagerTours';
import { useAssetData } from './hooks/useAssetData';
import { useSelectionHandlers, type VisibleIds } from './hooks/useSelectionHandlers';
import { useAssetCrud } from './hooks/useAssetCrud';
import { useTagsAndCollections } from './hooks/useTagsAndCollections';
import { AssetTagMenuContext, type AssetTagMenuActions } from './components/assetTagMenuContext';
import { tagGroupOfTab } from './utils/assetTags';
import { useContextMenus } from './hooks/useContextMenus';
import { useStatblockLink } from './hooks/useStatblockLink';
import { useAssetManagerEffects } from './hooks/useAssetManagerEffects';
import { useAssetManagerShortcuts } from './hooks/useAssetManagerShortcuts';
import { hasOpenDialog } from './utils/openDialogs';
import { useFollowSelectedCollection } from './hooks/useFollowSelectedCollection';
import { useOverlayBodyClass } from './hooks/useOverlayBodyClass';
import { useSidebarLayout } from './hooks/useSidebarLayout';
import { useRememberedPlace } from './hooks/useRememberedPlace';
import { useLeaveHiddenFolder } from './hooks/useLeaveHiddenFolder';
import { useDisplayedContent } from './hooks/useDisplayedContent';
import { useRevealMoved } from './hooks/useRevealMoved';
import { ActiveFilterBar } from './components/search/ActiveFilterBar';
import { showDungeonGenerator } from '../dungeon-generator/openDungeonGenerator';
import { runInBackground } from '../../../utils/backgroundTask';
import { TabSwitcher } from './components/TabSwitcher';
import { CompendiumPane } from './compendium/CompendiumPane';
import { MapPickContext } from './mapPick';

/** What a window opened to choose a map does instead of editing: nothing. */
const IGNORE = (): void => {};

export default function AssetManager({ isOpen: isOpenProp, onClose, initialTab, onExitComplete, pick }: AssetManagerProps): React.JSX.Element {
  const isOpen = useOpenedAfterPress(isOpenProp);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>(pick ? 'maps' : 'tokens');
  // The compendium takes the place of the library while it is open; the asset type stays as it was.
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const [compendiumDialogOpen, setCompendiumDialogOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(() => AssetService.defaultCollectionId());
  const [collapsedSections, setCollapsedSections] = useState<{ folders: boolean; assets: boolean }>({ folders: false, assets: false });
  const [draggedItems, setDraggedItems] = useState<{ type: 'asset' | 'folder'; ids: string[] } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useOverlayBodyClass(modalRef);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebar = useSidebarLayout(containerRef, isOpen);

  const data = useAssetData(activeTab, selectedCollection, isOpen);
  useFollowSelectedCollection(data.collections, selectedCollection, setSelectedCollection);
  const settings = useAtlasSettings(SettingsService.forApp(data.app));

  const visibleIds = useRef<VisibleIds>({ assets: [], folders: [] });
  const sel = useSelectionHandlers(visibleIds, data.folders, activeTab, isOpen);
  useLeaveHiddenFolder(data, sel);

  // Another tab or collection renders the whole window again: as a transition, in slices between frames.
  const changeTab = useCallback((tab: Tab): void => {
    // Choosing a map keeps to the Maps tab, whatever key or control asks for another.
    if (pick) return;
    setCompendiumOpen(false);
    if (tab === activeTab) return;
    startTransition(() => {
      setActiveTab(tab);
      sel.resetForTab();
    });
  }, [activeTab, sel.resetForTab, pick]);

  const openCompendium = useCallback((): void => {
    setCompendiumOpen(true);
    sel.resetForTab();
  }, [sel.resetForTab]);

  const memory = useRememberedPlace({
    isOpen, initialTab: pick ? 'maps' : initialTab, data, sel, remember: !pick,
    place: { collection: selectedCollection, tab: activeTab, search, collapsedSections },
    apply: (place) => {
      setActiveTab(place.tab);
      setSelectedCollection(place.collection);
      setSearch(place.search);
      setCollapsedSections(place.collapsedSections);
    },
  });

  // The open folder, the selection and the tags belong to the collection they were chosen in.
  const changeCollection = (collectionId: string): void => {
    if (collectionId === selectedCollection) return;
    startTransition(() => {
      setSelectedCollection(collectionId);
      sel.resetForTab();
    });
  };

  const { creature, filterSearch, shown, showSkeleton, showTagSkeleton, isFiltering } = useDisplayedContent({
    isOpen, activeTab, selectedCollection, search, setSearch, data, sel, visibleIds,
  });

  // Where a move's notice takes the GM: the cards' new place, with them selected (decision #37).
  const reveal = useRevealMoved({ selectedCollection, changeCollection, assets: data.assets, assetsLoading: data.assetsLoading, sel });

  const crud = useAssetCrud(
    data.app, data.assetService, activeTab, selectedCollection,
    sel.selectedFolderId, data.folders, data.collections,
    data.setFolders, data.reloadCollections, setSelectedCollection,
    data.loadFoldersForActiveTab, data.loadAssetsForActiveTab,
    draggedItems, setDraggedItems, setDropTarget, data.setAssets, reveal.inFolder, sel,
  );

  const tags = useTagsAndCollections(
    data.assetService, selectedCollection, data.tagsByGroup,
    data.setAssets, data.reloadCollections, data.reloadGlobalTags,
  );
  const tagGroup = tagGroupOfTab(activeTab);
  const tagMenuActions = useMemo((): AssetTagMenuActions => ({
    tags: data.availableTags,
    setAssetTags: tags.setAssetTags,
    createTag: (name) => tags.handleCreateTag(tagGroup, name),
  }), [data.availableTags, tags.setAssetTags, tags.handleCreateTag, tagGroup]);

  const statblock = useStatblockLink(data.app);

  const { handleAssetContextMenu, handleAssetDelete, handleFolderContextMenu, handleContentContextMenu } =
    useContextMenus({ data, sel, crud, tags, statblock, selectedCollection, activeTab, onClose, openCollection: reveal.inCollection });
  // Choosing a map edits nothing: no menus, no moves, no deletes.
  const editing = pick ? null : { handleAssetContextMenu, handleAssetDelete, handleFolderContextMenu, handleContentContextMenu, setDraggedItems };

  useAssetManagerEffects({
    isOpen, onClose,
    modalRef, containerRef,
    activeTab, changeTab,
    data, sel, crud, tags, statblock, setSearch,
    compendiumOpen,
    compendiumDialogOpen: compendiumOpen && compendiumDialogOpen,
  });
  const createMenu = useRef<HeaderMenuHandle>(null);
  useAssetManagerShortcuts(data.app, isOpen && !hasOpenDialog(crud, tags, statblock), containerRef, changeTab, () => createMenu.current?.open());

  const onCreate: Record<CreatableTab, () => void> = {
    tokens: () => crud.setIsTokenCreatorOpen(true),
    maps: crud.handleCreateMap,
    encounters: () => crud.setIsEncounterBuilderOpen(true),
  };

  const emptyAction = pick ? null : (
    <EmptyTabAction tab={shown.tab} onCreate={onCreate} onShowMaps={() => changeTab('maps')} />
  );

  return (
    <MapPickContext.Provider value={pick ?? null}>
      <AssetManagerWindow isOpen={isOpen} onClose={onClose} onExitComplete={onExitComplete} overlayRef={overlayRef}>
        <div
          className={`atlas-asset-manager-container ${sidebar.isFloating && !compendiumOpen ? 'atlas-sidebar-floating' : ''}`}
          ref={containerRef}
        >
          {compendiumOpen ? (
            <CompendiumPane
              app={data.app}
              tabs={<TabSwitcher activeTab={activeTab} onTabChange={changeTab} assetCounts={data.assetCounts} countsFailed={data.assetsFailed} compendium={{ open: true, onOpen: openCompendium }} />}
              onClose={onClose}
              onDialogChange={setCompendiumDialogOpen}
            />
          ) : (<>
          <Sidebar
            selectedTagIds={sel.selectedTagIds}
            onSelectTag={sel.handleTagSelect}
            onClearTags={() => sel.setSelectedTagIds([])}
            tags={data.availableTags}
            tagsLoading={showTagSkeleton}
            tagsFailed={data.assetsFailed}
            countedAssets={creature.matching}
            collections={data.collections}
            selectedCollection={selectedCollection}
            onSelectCollection={changeCollection}
            {...(!pick && { onManageTags: () => tags.setIsTagManagerOpen(true) })}
            {...(!pick && {
              onEditCollectionSettings: crud.setSettingsModalCollectionId,
              onExportCollection: () => { void crud.handleExportCollection(); },
              onImportCollection: crud.handleImportCollection,
            })}
            layout={sidebar}
          />
          <Header
            app={data.app}
            search={search}
            onSearch={setSearch}
            query={filterSearch}
            activeTab={activeTab}
            onTabChange={changeTab}
            assetCounts={data.assetCounts}
            countsFailed={data.assetsFailed}
            onCreateTokens={() => crud.setIsTokenCreatorOpen(true)}
            onCreateMap={crud.handleCreateMap}
            onGenerateDungeon={() => {
              runInBackground(showDungeonGenerator(data.app, selectedCollection), 'Opening the dungeon generator');
              onClose();
            }}
            onCreateEncounter={() => crud.setIsEncounterBuilderOpen(true)}
            onCreateCollection={crud.handleCreateCollection}
            onCreateFolder={crud.handleCreateFolder}
            createMenu={createMenu}
            sidebarToggleLabel={sidebar.toggleLabel}
            onToggleSidebar={sidebar.toggle}
            sel={sel}
            {...(pick ? { pick } : { onOpenCompendium: openCompendium })}
          />
          <div
            className="atlas-asset-manager-body"
            onDragOver={(e) => { if (!pick && draggedItems && sel.selectedFolderId === null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
            onDrop={(e) => { if (!pick && draggedItems && sel.selectedFolderId === null) { e.preventDefault(); crud.handleDrop(null); } }}
          >
            <ActiveFilterBar groups={filterSearch.chips} onReset={filterSearch.reset} />
            {/* A filtered list holds the matches of every folder, so the location reads as the tab's root while it shows. */}
            <LocationBar
              activeTab={shown.tab}
              path={isFiltering ? [] : shown.folderPath}
              onNavigateToFolder={sel.handleNavigateToFolder}
              sort={sel}
            />
            <div className="atlas-asset-manager-main">
              <AssetTagMenuContext.Provider value={tagMenuActions}>
                <Content
                  collection={shown.collection}
                  collectionName={data.collections.find((option) => option.id === shown.collection)?.name ?? shown.collection}
                  failed={shown.failed}
                  onRetry={data.retryLoad}
                  activeTab={shown.tab}
                  assets={shown.assets}
                  folders={shown.folders}
                  selectedAssetIds={sel.selectedAssetIds}
                  selectedFolderIds={sel.selectedFolderIds}
                  selectedFolderId={shown.folderId}
                  folderDepth={shown.folderPath.length}
                  refinement={shown.refinement}
                  loading={shown.loading}
                  showSkeleton={showSkeleton}
                  assetCount={data.assetCounts?.[shown.tab] ?? null}
                  scrollKey={`${shown.collection ?? 'default'}/${shown.tab}/${shown.folderId ?? ''}?${shown.refinement}`}
                  scrollMemory={memory}
                  onAssetSelect={sel.handleAssetSelect}
                  onAssetContextMenu={editing?.handleAssetContextMenu ?? IGNORE}
                  onAssetDelete={editing?.handleAssetDelete ?? IGNORE}
                  onLinkStatblock={statblock.openStatblockLinkModal}
                  onFolderSelection={sel.handleFolderSelection}
                  onFolderContextMenu={editing?.handleFolderContextMenu ?? IGNORE}
                  onFolderDoubleClick={sel.handleFolderDoubleClick}
                  onContentContextMenu={editing?.handleContentContextMenu ?? IGNORE}
                  onClearSelection={sel.handleClearSelection}
                  onSelectAll={sel.handleSelectAll}
                  onClose={onClose}
                  collapsedSections={collapsedSections}
                  setCollapsedSections={setCollapsedSections}
                  draggedItems={draggedItems}
                  setDraggedItems={editing?.setDraggedItems ?? IGNORE}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                  onDrop={crud.handleDrop}
                  view={data.view}
                  app={data.app}
                  emptyAction={emptyAction}
                  assetService={data.assetService}
                  spawnCounts={sel.spawnCounts}
                  onSpawnCountChange={sel.handleSpawnCountChange}
                  reveal={reveal.gridReveal}
                  {...(isFiltering ? { onClearFilters: filterSearch.reset } : {})}
                />
              </AssetTagMenuContext.Provider>
            </div>
          </div>
          </>)}
        </div>
      </AssetManagerWindow>

      {!pick && <AssetManagerTours isOpen={isOpen && !compendiumOpen} settings={settings} crud={crud} tags={tags} statblock={statblock} onShowMaps={() => changeTab('maps')} />}

      {!pick && <ModalLayer
        isOpen={isOpen}
        activeTab={activeTab}
        selectedCollection={selectedCollection}
        onClose={onClose}
        data={data}
        sel={sel}
        crud={crud}
        tags={tags}
        statblock={statblock}
      />}
    </MapPickContext.Provider>
  );
}
