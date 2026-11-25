// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LightingToolBar } from '../../src/app/packages/components/toolbar/LightingToolBar';
import { AtlasUIContext, type AtlasUIContextValue } from '../../src/app/react/root/AtlasUIContext';
import { ViewStoreProvider } from '../../src/app/react/ViewStoreContext';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import { createInMemoryApp } from '../mocks/inMemoryVault';

const ui = { app: undefined, view: null, pixiApp: null, renderer: null } as unknown as AtlasUIContextValue;

afterEach(cleanup);

// The test of 18 November 2026 found Openings greyed without knowing why (#187).
describe('the lighting tool\'s Openings mode on a scene without levels', () => {
  it('is greyed, and its tooltip tells the GM to add a level first', async () => {
    const store = createViewAtlasStore(createInMemoryApp({ files: {} }).app, `openings-mode-${Math.random()}`);
    store.getState().setPersistenceEnabled(false);
    store.getState().setActiveTool('wall');
    render(<AtlasUIContext.Provider value={ui}><ViewStoreProvider store={store}><LightingToolBar /></ViewStoreProvider></AtlasUIContext.Provider>);

    const openings = screen.getByRole('button', { name: 'Openings' });
    expect(openings.getAttribute('aria-disabled')).toBe('true');
    await act(async () => openings.focus());
    expect((await screen.findAllByText('Openings look down to the level below: add a level to the scene first')).length).toBeGreaterThan(0);

    act(() => openings.click());
    expect(store.getState().lightingTool.mode).not.toBe('level-surface');
  });
});
