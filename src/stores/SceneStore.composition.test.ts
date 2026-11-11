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
  assets.push(
    {
      ...assets[0],
      size: 'S',
      width: 723,
      height: 430,
      viewBox: '37 -11 723 430',
      svg: '<svg viewBox="37 -11 723 430"><path d="M37 -11L760 419Z"/></svg>',
    },
    {
      ...assets[1],
      size: 'S',
      width: 473,
      height: 500,
      viewBox: '-9 21 473 500',
      svg: '<svg viewBox="-9 21 473 500"><path d="M-9 21L464 521Z"/></svg>',
    },
  );
  return { version: 1, assets };
}
function plan(): CompositionPlan {
  return {
    message: 'Учёба',
    items: [
      { assetId: 'book', role: 'main', size: 'S' },
      { assetId: 'phone', role: 'main', size: 'L' },
      { assetId: 'lamp', role: 'bg', size: 'S' },
    ],
  };
}

describe('SceneStore automatic composition', () => {
  it('applies mixed L/S and roles with one observable update and clears selection on success', () => {
    const store = new SceneStore(
      {
        ...createScene(),
        canvasId: 'canvas2',
        canvasSize: 'S',
        schemeId: 'teal',
      },
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
      canvasSize: 'S',
      schemeId: 'teal',
      width: 1000,
      height: 1000,
    });
    expect(store.scene.items.map((item) => item.assetId)).toEqual([
      'lamp',
      'phone',
      'book',
    ]);
    expect(
      store.scene.items.map(({ size, role, scale }) => ({ size, role, scale })),
    ).toEqual([
      { size: 'S', role: 'bg', scale: 1 },
      { size: 'L', role: 'main', scale: 1 },
      { size: 'S', role: 'main', scale: 1 },
    ]);
    const book = store.scene.items.find(({ assetId }) => assetId === 'book')!;
    const geometry = getObjectGeometry(book, library());
    expect(geometry.viewBox).toEqual([37, -11, 723, 430]);
    expect(geometry.asset.svg).toContain('M37 -11L760 419Z');
    expect(geometry.width).toBeCloseTo(723);
    expect(geometry.height).toBeCloseTo(430);
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

  it('preserves the full scene and selection when plan or geometry validation fails', () => {
    const store = new SceneStore(
      { ...createScene(), width: 300, height: 300 },
      library,
    );
    store.addItem('phone');
    const previous = store.scene;
    const snapshot = toJS(store.scene);
    const selected = store.selectedItem;
    for (const requested of [
      { ...plan(), items: [] },
      {
        ...plan(),
        items: [{ assetId: 'custom-icon', role: 'main', size: 'S' }],
      } as CompositionPlan,
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

  it.each(['bg', 'main'] as const)(
    'allows all items to have role %s without adding or dropping objects',
    (role) => {
      const store = new SceneStore(undefined, library);
      store.addItem('phone');
      store.applyComposition({
        ...plan(),
        items: plan().items.map((item) => ({ ...item, role })),
      });
      expect(store.scene.items).toHaveLength(3);
      expect(store.scene.items.every((item) => item.role === role)).toBe(true);
      expect(
        store.scene.items.map(({ assetId, size }) => ({ assetId, size })),
      ).toEqual([
        { assetId: 'phone', size: 'L' },
        { assetId: 'book', size: 'S' },
        { assetId: 'lamp', size: 'S' },
      ]);
      expect(store.selectedItem).toBeUndefined();
    },
  );

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
    expect(geometry.width).toBeCloseTo(24);
    expect(geometry.height).toBeCloseTo(12);
  });
});
