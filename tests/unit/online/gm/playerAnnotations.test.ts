// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_PLAYER_ANNOTATIONS, parsePlayerMessage, type PlayerAnnotationMessage } from '../../../../src/app/online/protocol/index.ts';
import { fogCoverage } from '../../../../src/app/fog/fogCoverage';
import { sharedAnnotations } from '../../../../src/app/online/gm/mapLayerInputs.ts';
import { PlayerAnnotations, type AnnotationStore } from '../../../../src/app/online/gm/PlayerAnnotations.ts';
import { getHistoryStore, runUntracked } from '../../../../src/app/stores/history';
import { ANA, BEN, SCENE, STORE_FACTORY, type StoreFactory } from './realStore.ts';

const { createViewAtlasStore } = (await import(/* @vite-ignore */ STORE_FACTORY)) as { createViewAtlasStore: StoreFactory };

const id = (n: number): string => n.toString(16).padStart(24, '0');
const pen = (n: number, points = [100, 100, 200, 120]): PlayerAnnotationMessage => ({ t: 'draw', scene: SCENE, id: id(n), drawing: { type: 'pen', points, colour: '#ffffff', width: 4 } });

/** A real Atlas view store with a loaded map of 2000 × 1500, and the players' annotations on it. */
function table(): { store: AnnotationStore & { getState(): ReturnType<AnnotationStore['getState']> }; annotations: PlayerAnnotations; history: NonNullable<ReturnType<typeof getHistoryStore>> } {
  const store = createViewAtlasStore({}, 'online-annotations-test') as unknown as AnnotationStore & { getState(): ReturnType<AnnotationStore['getState']> & { setPersistenceEnabled(on: boolean): void } };
  store.getState().setPersistenceEnabled(false);
  runUntracked(store as never, () => store.setState((draft) => {
    draft.mapLoaded = true;
  }));
  const history = getHistoryStore(store as never);
  if (history === null) throw new Error('the store has no history');
  history.getState().clear();
  let now = 0;
  const annotations = new PlayerAnnotations(store, { scene: () => SCENE, map: () => ({ width: 2000, height: 1500 }), now: () => (now += 1000) });
  return { store, annotations, history };
}

describe('players\' drawings and texts', () => {
  it('are kept in the scene as Atlas\'s own, marked with who made them, one undo step each', () => {
    const { store, annotations, history } = table();
    annotations.receive(ANA, pen(1));
    annotations.receive(ANA, { t: 'draw', scene: SCENE, id: id(2), drawing: { type: 'icon', points: [500, 400], colour: '#000000', width: 70, icon: 'skull' } });
    annotations.receive(BEN, { t: 'place-text', scene: SCENE, id: id(3), text: { x: 300, y: 300, text: 'Porte', fontSize: 24, colour: '#e93147', bold: true } });
    const { drawings, texts } = store.getState().objects;
    expect(drawings[`drawing_player_${id(1)}`]).toMatchObject({ type: 'pen', points: [{ x: 100, y: 100 }, { x: 200, y: 120 }], color: '#ffffff', width: 4, opacity: 1, author: ANA });
    expect(drawings[`drawing_player_${id(2)}`]).toMatchObject({ type: 'icon', icon: 'skull', author: ANA });
    // A text looks as one the GM's text tool places.
    expect(texts[`text_player_${id(3)}`]).toMatchObject({ text: 'Porte', fontSize: 24, color: '#e93147', bold: true, fontFamily: 'Arial', backgroundColor: '#000000', align: 'center', author: BEN });
    expect(history.getState().pastStates).toHaveLength(3);
    history.getState().undo();
    expect(store.getState().objects.texts[`text_player_${id(3)}`]).toBeUndefined();
  });

  it('reach every player with their id and maker, and the GM\'s own carry neither', () => {
    const { store, annotations } = table();
    annotations.receive(ANA, pen(1));
    runUntracked(store as never, () => store.setState((draft) => {
      draft.objects.drawings.drawing_gm = { id: 'drawing_gm', kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x: 1, y: 1 }], color: '#ffffff', width: 4, opacity: 1 };
    }));
    const shared = sharedAnnotations(store.getState().objects.drawings, store.getState().objects.texts, fogCoverage({}));
    const byPlayer = shared.drawings.find((drawing) => drawing.id !== undefined);
    expect(byPlayer).toMatchObject({ id: id(1), by: ANA });
    expect(shared.drawings.find((drawing) => drawing.id === undefined)).not.toHaveProperty('by');
  });

  it('are taken back only by whoever made them', () => {
    const { store, annotations } = table();
    annotations.receive(ANA, pen(1));
    annotations.receive(BEN, pen(2));
    annotations.receive(BEN, { t: 'erase', scene: SCENE, ids: [id(1), id(2)] });
    expect(Object.keys(store.getState().objects.drawings)).toEqual([`drawing_player_${id(1)}`]);
  });

  it('take nothing for another scene, off the map, an id taken, or past a player\'s share', () => {
    const { store, annotations } = table();
    annotations.receive(ANA, { ...pen(1), scene: 'other' } as PlayerAnnotationMessage);
    annotations.receive(ANA, pen(2, [100, 100, 5000, 100]));
    annotations.receive(ANA, pen(3));
    annotations.receive(BEN, pen(3, [10, 10, 20, 20]));
    expect(Object.keys(store.getState().objects.drawings)).toEqual([`drawing_player_${id(3)}`]);
    expect(store.getState().objects.drawings[`drawing_player_${id(3)}`]?.author).toBe(ANA);
    for (let n = 10; n < 10 + MAX_PLAYER_ANNOTATIONS + 5; n += 1) annotations.receive(BEN, pen(n));
    const bens = Object.values(store.getState().objects.drawings).filter((drawing) => drawing.author === BEN);
    expect(bens).toHaveLength(MAX_PLAYER_ANNOTATIONS);
  });
});

describe('the annotation messages a player sends', () => {
  it('are read as the protocol says and refused when malformed', () => {
    expect(parsePlayerMessage(pen(1))).toEqual(pen(1));
    expect(parsePlayerMessage({ ...pen(1), id: 'not-an-id' })).toBeNull();
    expect(parsePlayerMessage({ t: 'draw', scene: SCENE, id: id(1), drawing: { type: 'pen', points: Array.from({ length: 302 }, () => 1), colour: '#ffffff', width: 4 } })).toBeNull();
    expect(parsePlayerMessage({ t: 'draw', scene: SCENE, id: id(1), drawing: { type: 'pen', points: [1, 2], colour: '#FFFFFF', width: 4 } })).toBeNull();
    expect(parsePlayerMessage({ t: 'draw', scene: SCENE, id: id(1), drawing: { type: 'pen', points: [1, 2], colour: '#ffffff', width: 400 } })).toBeNull();
    expect(parsePlayerMessage({ t: 'place-text', scene: SCENE, id: id(1), text: { x: 1, y: 1, text: '   ', fontSize: 24, colour: '#ffffff', bold: false } })).toBeNull();
    expect(parsePlayerMessage({ t: 'place-text', scene: SCENE, id: id(1), text: { x: 1, y: 1, text: ' Salut ', fontSize: 24, colour: '#ffffff', bold: false } })).toMatchObject({ text: { text: 'Salut' } });
    expect(parsePlayerMessage({ t: 'erase', scene: SCENE, ids: [] })).toBeNull();
    expect(parsePlayerMessage({ t: 'erase', scene: SCENE, ids: [id(1), id(1)] })).toEqual({ t: 'erase', scene: SCENE, ids: [id(1)] });
  });
});
