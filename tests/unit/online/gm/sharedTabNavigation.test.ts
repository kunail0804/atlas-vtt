import type { WorkspaceLeaf } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { TabWatch, type LostReason, type TabBinding } from '../../../../src/app/online/gm/sharedTab.ts';

const MAP = 'maps/test2.atlasmap';
const PRESENTED = { tabId: 'tab-1', filePath: MAP };

const subscribe = (): (() => void) => () => undefined;

/** A leaf showing an Atlas map tab, as `atlasTabOf` and `findPresentedTab` read one; the map starts loaded. */
function atlasLeaf(): WorkspaceLeaf & { view: { navigation: boolean } } {
  const store = { getState: () => ({ mapPath: MAP, mapLoaded: true, isMapLoading: false }), setState: () => undefined, subscribe };
  const renderer = {};
  const tabs = { getState: () => ({ tabs: [{ id: 'tab-1', filePath: MAP, displayName: 'test2' }], activeTabId: 'tab-1' }), subscribe };
  const view = {
    navigation: true,
    getViewType: () => 'atlas-vtt',
    atlasStore: store,
    tabMetaStore: tabs,
    serviceManager: { getRendererService: () => ({ getRenderer: () => renderer }) },
  };
  return { view } as unknown as WorkspaceLeaf & { view: { navigation: boolean } };
}

const binding = (): TabBinding => ({ start: () => undefined, stop: () => undefined, present: () => undefined, showing: true });

/**
 * While a map tab is shared, Obsidian opens a note asked for in it in another tab, instead of
 * putting the note in the map's place and leaving the players without a map (#189): the view says
 * it is no place to navigate to, which Obsidian's `WorkspaceLeaf.canNavigate` reads
 * (`view.navigation && !pinned`, Obsidian 1.15.1) when Ctrl+O or a link asks for `getLeaf(false)`.
 */
describe('the shared map tab', () => {
  it('opens notes elsewhere while it is shared, and navigates as before once it is not', () => {
    const leaf = atlasLeaf();
    let leaves: WorkspaceLeaf[] = [leaf];
    let presented: typeof PRESENTED | null = PRESENTED;
    const lost: LostReason[] = [];
    const watch = new TabWatch({ leaves: () => leaves, presented: () => presented, bind: binding, lost: (reason) => void lost.push(reason), mapPath: () => undefined }, null);

    expect(leaf.view.navigation).toBe(true);
    watch.check();
    expect(watch.current?.leaf).toBe(leaf);
    expect(leaf.view.navigation).toBe(false);

    // Atlas presents nothing any more: the tab is no longer shared, and Obsidian may navigate it again.
    presented = null;
    watch.check();
    expect(lost).toEqual(['unpresented']);
    expect(leaf.view.navigation).toBe(true);

    // Shared again, then its leaf closed: the view it had gets its navigation back too.
    presented = PRESENTED;
    watch.check();
    expect(leaf.view.navigation).toBe(false);
    leaves = [];
    watch.check();
    expect(lost).toEqual(['unpresented', 'closed']);
    expect(leaf.view.navigation).toBe(true);
  });

  it('gives the view its navigation back when the watch stops', () => {
    const leaf = atlasLeaf();
    const watch = new TabWatch({ leaves: () => [leaf], presented: () => PRESENTED, bind: binding, lost: () => undefined, mapPath: () => undefined }, null);
    watch.check();
    expect(leaf.view.navigation).toBe(false);
    watch.stop();
    expect(leaf.view.navigation).toBe(true);
  });
});
