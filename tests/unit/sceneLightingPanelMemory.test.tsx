// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SceneLightingPanelHost } from '../../src/app/pixi/lighting/SceneLightingPanel';
import { ViewStoreProvider } from '../../src/app/react/ViewStoreContext';
import { createViewAtlasStore, type ViewAtlasStore } from '../../src/app/storeFactory';
import { createInMemoryApp } from '../mocks/inMemoryVault';

describe('the scene lighting panel\'s choice of who reveals explored memory', () => {
  let store: ViewAtlasStore;

  beforeEach(() => {
    store = createViewAtlasStore(createInMemoryApp({ files: {} }).app, `scene-lighting-panel-${Math.random()}`);
    store.getState().setPersistenceEnabled(false);
    store.getState().setSceneLighting({ enabled: true });
    store.getState().setSceneLightingPanelOpen(true);
    render(<ViewStoreProvider store={store}><SceneLightingPanelHost /></ViewStoreProvider>);
  });

  afterEach(cleanup);

  const option = (name: string): HTMLElement => screen.getByRole('radio', { name });

  it('shows the GM revealing by hand in a scene that sets nothing', () => {
    expect(option('GM, by hand').getAttribute('aria-checked')).toBe('true');
    expect(option('Players\' tokens').getAttribute('aria-checked')).toBe('false');
  });

  it('stores the players\' choice, and the GM\'s as no choice at all', () => {
    act(() => option('Players\' tokens').click());
    expect(store.getState().lighting.exploredBy).toBe('players');
    expect(option('Players\' tokens').getAttribute('aria-checked')).toBe('true');
    act(() => option('GM, by hand').click());
    expect('exploredBy' in store.getState().lighting).toBe(false);
  });

  it('stays in place but cannot be set while the scene remembers nothing', () => {
    act(() => store.getState().setSceneLighting({ exploredMemory: false }));
    expect((option('Players\' tokens') as HTMLButtonElement).disabled).toBe(true);
    act(() => option('Players\' tokens').click());
    expect(store.getState().lighting.exploredBy).toBeUndefined();
  });
});
