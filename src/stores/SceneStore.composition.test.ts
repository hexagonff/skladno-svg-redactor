import { autorun, toJS } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { CompositionPlan } from '../domain/composition';
import type { LibraryAsset, LibraryManifest } from '../domain/library';
import { getObjectGeometry } from '../domain/objectGeometry';
import { createScene } from '../domain/scene';
import { SceneStore } from './SceneStore';

function library(): LibraryManifest {
  const assets: LibraryAsset[] = [
    ['book', 1446, 977],
    ['lamp', 946, 1129],
    ['phone', 797, 462],
    ['custom-icon', 24, 12],
  ].map(([id, width, height]) => ({
    id: id as LibraryAsset['id'],
    width: Number(width),
    height: Number(height),
    size: 'L',
    kind: 'object',
    sourceScheme: 'purple',
    viewBox: `0 0 ${width} ${height}`,
    svg: '<svg/>',
  }));
  return { version: 1, assets };
}
function plan(): CompositionPlan {
  return {
    message: 'Учёба',
    items: [
      { assetId: 'book', role: 'main' },
      { assetId: 'phone', role: 'main' },
      { assetId: 'lamp', role: 'bg' },
    ],
  };
}

describe('SceneStore automatic composition', () => {
  it('applies a complete composition with one observable update and clears selection on success', () => {
    const store = new SceneStore(
      { ...createScene(), canvasId: 'canvas2', schemeId: 'teal' },
      library,
    );
    store.addItem('book');
    const oldId = store.selectedItemId;
    const states: string[] = [];
    const dispose = autorun(() => {
      states.push(
        `${store.scene.items.length}/${store.selectedItemId ?? 'none'}`,
      );
    });
    const { applyComposition } = store;
    applyComposition(plan());
    dispose();
    expect(states).toEqual([`1/${oldId}`, '3/none']);
    expect(store.scene).toMatchObject({
      canvasId: 'canvas2',
      schemeId: 'teal',
      width: 1000,
      height: 1000,
    });
    expect(store.scene.items.map((item) => item.assetId)).toEqual([
      'lamp',
      'book',
      'phone',
    ]);
    expect(store.scene.items.map((item) => item.id)).not.toContain(oldId);
    expect(store.selectedItem).toBeUndefined();
    store.selectItem(store.scene.items[0].id);
    store.rotateSelected('clockwise');
    expect(store.selectedItem?.rotation).toBe(15);
  });

  it('never reuses manually or automatically issued IDs after replacement and deletion', () => {
    const store = new SceneStore(undefined, library);
    const issued = new Set<string>();
    store.addItem('phone');
    issued.add(store.selectedItemId!);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      store.applyComposition(plan(), attempt);
      for (const item of store.scene.items) {
        expect(issued.has(item.id)).toBe(false);
        issued.add(item.id);
      }
      store.selectItem(store.scene.items[0].id);
      store.deleteSelectedItem();
    }
    store.addItem('book');
    expect(issued.has(store.selectedItemId!)).toBe(false);
  });

  it('preserves the full scene and selection when validation or fixed-size placement fails', () => {
    const store = new SceneStore(
      { ...createScene(), width: 300, height: 300 },
      library,
    );
    store.addItem('phone');
    const previous = store.scene;
    const snapshot = toJS(store.scene);
    const selected = store.selectedItem;
    for (const requested of [
      plan(),
      { ...plan(), items: [] },
      {
        ...plan(),
        items: [{ assetId: 'custom-missing', role: 'main' }],
      } as CompositionPlan,
    ]) {
      expect(() => store.applyComposition(requested)).toThrow();
      expect(store.scene).toBe(previous);
      expect(toJS(store.scene)).toEqual(snapshot);
      expect(store.selectedItem).toBe(selected);
    }
    expect(() => store.applyComposition(plan(), Number.NaN)).toThrow();
    expect(store.scene).toBe(previous);
    store.addItem('book');
    expect(store.selectedItemId).toBe('item-2');
  });

  it('requires a library callback and uses exactly the manual initial scale for imported SVG', () => {
    const unregistered = new SceneStore();
    unregistered.addItem('book');
    const previous = unregistered.scene;
    const selected = unregistered.selectedItem;
    expect(() => unregistered.applyComposition(plan())).toThrow(
      /каталог объектов/,
    );
    expect(unregistered.scene).toBe(previous);
    expect(unregistered.selectedItem).toBe(selected);
    const manifest = library();
    const store = new SceneStore(undefined, () => manifest);
    store.addItem('custom-icon');
    const manual = { ...store.selectedItem! };
    store.applyComposition({
      message: 'Свой объект',
      items: [{ assetId: 'custom-icon', role: 'main' }],
    });
    expect(store.scene.items[0].scale).toBe(manual.scale);
    const geometry = getObjectGeometry(store.scene.items[0], manifest);
    expect(geometry.width).toBeCloseTo(250);
    expect(geometry.height).toBeCloseTo(125);
  });
});
