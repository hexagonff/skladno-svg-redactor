import { autorun, toJS } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { ColorRole } from '../domain/colors';
import type { ObjectColorOverrides } from '../domain/objectColors';
import builtinSchemes from '../assets/schemes.json';
import { createCustomScheme } from '../domain/schemes';
import { inspectImportedSvg } from '../services/svg/importSvg';
import { LibraryStore } from './LibraryStore';
import { SchemeStore } from './SchemeStore';
import {
  CANVAS_IDS,
  SCHEME_IDS,
  type AssetSize,
  type CanvasId,
  type ColorScheme,
  type SchemeId,
} from '../domain/library';
import {
  addSceneItem,
  createScene,
  createSceneItem,
  ROTATION_STEP,
  type ObjectId,
  type RotationDirection,
  type SceneRole,
} from '../domain/scene';
import { SceneStore } from './SceneStore';

describe('SceneStore', () => {
  it('starts empty without selection', () => {
    const store = new SceneStore();
    expect(store.scene).toEqual(createScene());
    expect(store.selectedItemId).toBeNull();
    expect(store.selectedItem).toBeUndefined();
    const empty = store.scene;
    store.setSelectedRole('bg');
    store.setSelectedSize('S');
    expect(store.scene).toBe(empty);
    expect(store.scene.items).toEqual([]);
  });

  it('adds unique repeated instances, selects the latest, and offsets repeats', () => {
    const store = new SceneStore();
    store.addItem('book');
    store.addItem('book');
    store.addItem('phone');
    expect(new Set(store.scene.items.map((item) => item.id)).size).toBe(3);
    expect(store.scene.items.map((item) => item.assetId)).toEqual([
      'book',
      'book',
      'phone',
    ]);
    expect(store.scene.items[0]).toMatchObject({
      x: 500,
      y: 500,
      size: 'L',
      scale: 0.35,
    });
    expect(store.scene.items[1]).toMatchObject({
      x: 524,
      y: 524,
      size: 'L',
      scale: 0.35,
    });
    expect(store.selectedItem).toBe(store.scene.items[2]);
  });

  it('avoids ID collisions with supplied initial scenes and owns its data', () => {
    const initial = addSceneItem(
      createScene(),
      createSceneItem('book', 'item-1'),
    );
    const store = new SceneStore(initial);
    initial.items[0].x = 12;
    initial.items.push(createSceneItem('pen', 'external'));
    store.addItem('phone');
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-1',
      'item-2',
    ]);
    expect(store.scene.items[0].x).toBe(500);
    expect(store.selectedItemId).toBe('item-2');
  });

  it('changes only the selected size while preserving poses, IDs, order, and selection', () => {
    const initial = addSceneItem(createScene(), {
      ...createSceneItem('book', 'custom'),
      x: 321,
      y: 123,
      scale: 1.12,
      rotation: 37,
    });
    const store = new SceneStore(initial);
    store.addItem('vase');
    store.selectItem('custom');
    const before = store.scene.items.map((item) => ({ ...item }));
    store.setSelectedSize('S');
    store.setScheme('teal');
    expect(store.scene.items.map((item) => item.size)).toEqual(['S', 'L']);
    expect(store.scene.schemeId).toBe('teal');
    expect(store.scene.items).toEqual([{ ...before[0], size: 'S' }, before[1]]);
    expect(store.selectedItem).toBe(store.scene.items[0]);
    store.setSelectedRole('bg');
    expect(store.selectedItem).toBe(store.scene.items[0]);
    expect(store.selectedItem).toEqual({
      ...before[0],
      size: 'S',
      role: 'bg',
    });
    expect(store.scene.items[1]).toEqual(before[1]);
    store.setSelectedSize('L');
    expect(store.scene.items[0]).toEqual({ ...before[0], role: 'bg' });
  });

  it('clears selection and rejects unknown IDs without losing current selection', () => {
    const store = new SceneStore();
    store.addItem('book');
    const selectedId = store.selectedItemId;
    expect(() => store.selectItem('missing')).toThrow(/Unknown scene item/);
    expect(store.selectedItemId).toBe(selectedId);
    store.selectItem(null);
    expect(store.selectedItem).toBeUndefined();
    store.setSelectedRole('bg');
    const before = store.scene;
    store.setSelectedSize('S');
    expect(store.scene).toBe(before);
    expect(store.scene.items[0]).toMatchObject({ role: 'main', size: 'L' });
  });

  it('moves instances independently and keeps the current selection', () => {
    const store = new SceneStore();
    store.addItem('book');
    store.addItem('book');
    const first = { ...store.scene.items[0] };
    const second = { ...store.scene.items[1] };
    store.moveItem(first.id, { x: -500, y: 120000 });
    expect(store.scene.items[0]).toEqual({ ...first, x: -500, y: 120000 });
    expect(store.scene.items[1]).toEqual(second);
    expect(store.selectedItemId).toBe(second.id);

    store.selectItem(first.id);
    store.moveItem(first.id, { x: 122, y: -355 });
    expect(store.selectedItem).toEqual({ ...first, x: 122, y: -355 });
  });

  it('keeps a moved pose through size and scheme changes, then deletes only the selection', () => {
    const initial = addSceneItem(createScene(), {
      ...createSceneItem('book', 'custom'),
      scale: 0.725,
      rotation: -32,
      role: 'bg',
    });
    const store = new SceneStore(initial);
    store.addItem('book');
    const repeated = { ...store.selectedItem! };
    store.selectItem('custom');
    store.moveItem('custom', { x: -1200, y: 1000000 });
    store.setSelectedSize('S');
    store.setScheme('teal');
    store.setSelectedSize('L');
    expect(store.selectedItem).toEqual({
      ...initial.items[0],
      x: -1200,
      y: 1000000,
    });
    const deleted = { ...store.selectedItem! };
    store.deleteSelectedItem();
    expect(store.selectedItemId).toBeNull();
    expect(store.selectedItem).toBeUndefined();
    expect(store.scene.items).toEqual([repeated]);
    expect(store.scene.schemeId).toBe('teal');
    expect(store.scene.items[0].size).toBe('L');
    expect(initial.items[0]).toMatchObject({ x: 500, y: 500 });
    expect(deleted).toMatchObject({ x: -1200, y: 1000000 });

    store.addItem('book');
    const nextId = store.selectedItemId;
    expect(nextId).not.toBe(deleted.id);
    expect(nextId).not.toBe(repeated.id);
    store.deleteSelectedItem();
    store.addItem('book');
    expect(store.selectedItemId).not.toBe(nextId);
  });

  it('does not reuse deleted IDs from the supplied initial scene', () => {
    const store = new SceneStore(
      addSceneItem(createScene(), createSceneItem('book', 'item-2')),
    );
    store.selectItem('item-2');
    store.deleteSelectedItem();
    store.addItem('book');
    store.addItem('book');
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-1',
      'item-3',
    ]);
  });

  it('deletes the last instance and treats deletion without selection as a no-op', () => {
    const store = new SceneStore();
    const empty = store.scene;
    store.deleteSelectedItem();
    expect(store.scene).toBe(empty);
    store.addItem('book');
    store.selectItem(null);
    const populated = store.scene;
    store.deleteSelectedItem();
    expect(store.scene).toBe(populated);
    store.selectItem(store.scene.items[0].id);
    store.deleteSelectedItem();
    expect(store.scene.items).toEqual([]);
    expect(store.selectedItemId).toBeNull();
  });

  it('rejects invalid moves without replacing the scene or changing selection', () => {
    const store = new SceneStore();
    store.addItem('book');
    const before = store.scene;
    const selection = store.selectedItemId!;
    expect(() => store.moveItem('missing', { x: 1, y: 2 })).toThrow(
      /Unknown scene item/,
    );
    expect(() => store.moveItem(selection, { x: Number.NaN, y: 0 })).toThrow(
      /finite/,
    );
    expect(() =>
      store.moveItem(selection, { x: 0, y: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite/);
    expect(store.scene).toBe(before);
    expect(store.selectedItemId).toBe(selection);
  });

  it('notifies observers when bound move and delete actions update the selection', () => {
    const store = new SceneStore();
    store.addItem('book');
    const observed: string[] = [];
    const dispose = autorun(() => {
      observed.push(
        store.selectedItem
          ? `${store.selectedItem.x},${store.selectedItem.y}`
          : 'none',
      );
    });
    const { moveItem, deleteSelectedItem } = store;
    moveItem(store.selectedItemId!, { x: -25, y: 1250 });
    deleteSelectedItem();
    dispose();
    expect(observed).toEqual(['500,500', '-25,1250', 'none']);
  });

  it('notifies observers of scene and selected-item changes, with bound actions', () => {
    const store = new SceneStore();
    const observed: string[] = [];
    const dispose = autorun(() => {
      observed.push(
        `${store.selectedItem?.size ?? 'none'}/${store.scene.schemeId}/${store.selectedItem?.role ?? 'none'}`,
      );
    });
    const { addItem, setSelectedSize, setScheme, setSelectedRole } = store;
    addItem('book');
    setSelectedSize('S');
    setScheme('orange');
    setSelectedRole('bg');
    dispose();
    expect(observed).toEqual([
      'none/purple/none',
      'L/purple/main',
      'S/purple/main',
      'S/orange/main',
      'S/orange/bg',
    ]);
  });

  it('rejects invalid inputs without replacing the current scene or selection', () => {
    const store = new SceneStore();
    store.addItem('book');
    const before = store.scene;
    const selection = store.selectedItemId;
    expect(() => store.addItem('canvas1' as ObjectId)).toThrow(
      /Unknown object/,
    );
    expect(() => store.setSelectedSize('M' as AssetSize)).toThrow(
      /object size/,
    );
    expect(() => store.setScheme('missing' as SchemeId)).toThrow(
      /color scheme/,
    );
    expect(() => store.setSelectedRole('missing' as SceneRole)).toThrow(
      /Unknown scene role/,
    );
    expect(store.scene).toBe(before);
    expect(store.selectedItemId).toBe(selection);
    expect(() => new SceneStore({ ...createScene(), width: -1 })).toThrow(
      /dimensions/,
    );
  });
});

describe('SceneStore object colors', () => {
  it('changes only the selected instance and preserves choices through size, scheme, and role changes', () => {
    const store = new SceneStore();
    store.addItem('wallet');
    const firstId = store.selectedItemId!;
    store.addItem('wallet');
    const secondId = store.selectedItemId!;
    store.selectItem(firstId);
    store.setSelectedColor('bg1', 'obj1');
    store.setSelectedSize('S');
    store.setScheme('orange');
    store.setSelectedRole('bg');
    store.setSelectedColor('bg1', 'bg3');
    store.setSelectedRole('main');
    expect(store.selectedItem?.colorOverrides).toEqual({
      main: { bg1: 'obj1' },
      bg: { bg1: 'bg3' },
    });
    expect(store.selectedItem?.size).toBe('S');
    expect(
      store.scene.items.find((item) => item.id === secondId)?.colorOverrides,
    ).toBeUndefined();
    expect(store.scene.items.find((item) => item.id === secondId)?.size).toBe(
      'L',
    );
    store.selectItem(secondId);
    store.setSelectedSize('S');
    store.selectItem(firstId);
    store.setSelectedSize('L');
    expect(store.selectedItem?.colorOverrides).toEqual({
      main: { bg1: 'obj1' },
      bg: { bg1: 'bg3' },
    });
    expect(store.scene.items.map((item) => item.size)).toEqual(['L', 'S']);
    store.resetSelectedColors();
    expect(store.selectedItem?.colorOverrides).toEqual({ bg: { bg1: 'bg3' } });
    store.setSelectedRole('bg');
    store.resetSelectedColors();
    expect(store.selectedItem?.colorOverrides).toBeUndefined();
  });

  it('deeply owns supplied override maps even when initial instances share them', () => {
    const overrides: {
      main: ObjectColorOverrides;
      bg: ObjectColorOverrides;
    } = { main: { bg1: 'obj1' }, bg: { bg1: 'bg2' } };
    const initial = {
      ...createScene(),
      items: ['first', 'second'].map((id) => ({
        ...createSceneItem('wallet', id),
        colorOverrides: overrides,
      })),
    };
    const store = new SceneStore(initial);
    delete initial.items[0].colorOverrides.main.bg1;
    delete initial.items[0].colorOverrides.bg.bg1;
    expect(store.scene.items.map((item) => item.colorOverrides)).toEqual([
      { main: { bg1: 'obj1' }, bg: { bg1: 'bg2' } },
      { main: { bg1: 'obj1' }, bg: { bg1: 'bg2' } },
    ]);
    expect(store.scene.items[0].colorOverrides?.main).not.toBe(
      store.scene.items[1].colorOverrides?.main,
    );
    expect(store.scene.items[0].colorOverrides?.bg).not.toBe(
      store.scene.items[1].colorOverrides?.bg,
    );
  });

  it('does nothing without a selection and rejects forbidden choices atomically', () => {
    const store = new SceneStore();
    const empty = store.scene;
    store.setSelectedColor('bg1', 'obj1');
    store.resetSelectedColors();
    expect(store.scene).toBe(empty);
    store.addItem('wallet');
    store.setSelectedRole('bg');
    const before = store.scene;
    const selectedId = store.selectedItemId;
    expect(() => store.setSelectedColor('bg1', 'obj1')).toThrow(/not allowed/);
    expect(() => store.setSelectedColor('bg1', 'white')).toThrow(/not allowed/);
    expect(() => store.setSelectedColor('other' as ColorRole, 'bg1')).toThrow(
      /not allowed/,
    );
    expect(store.scene).toBe(before);
    expect(store.selectedItemId).toBe(selectedId);
    store.selectItem(null);
    store.setSelectedColor('bg1', 'bg2');
    store.resetSelectedColors();
    expect(store.scene).toBe(before);
  });

  it('notifies observers once per bound color action and reset', () => {
    const store = new SceneStore();
    store.addItem('wallet');
    const observed: string[] = [];
    const dispose = autorun(() => {
      const item = store.selectedItem!;
      observed.push(item.colorOverrides?.[item.role]?.bg1 ?? 'bg1');
    });
    const { setSelectedColor, resetSelectedColors } = store;
    setSelectedColor('bg1', 'obj1');
    setSelectedColor('bg1', 'obj2');
    resetSelectedColors();
    dispose();
    expect(observed).toEqual(['bg1', 'obj1', 'obj2', 'bg1']);
  });
});

describe('SceneStore resizing', () => {
  it('changes only the selected scale while keeping pose, detail, and colors', () => {
    const store = new SceneStore();
    store.addItem('wallet');
    const first = store.selectedItemId!;
    store.addItem('wallet');
    const second = store.selectedItemId!;
    store.setSelectedColor('bg1', 'obj1');
    store.setSelectedSize('S');
    const before = { ...store.selectedItem! };
    store.setSelectedScale(0.8);
    expect(store.selectedItem).toEqual({ ...before, scale: 0.8 });
    expect(store.scene.items.find((item) => item.id === first)?.scale).toBe(
      0.35,
    );
    expect(store.selectedItemId).toBe(second);
    store.setSelectedSize('L');
    expect(store.selectedItem?.scale).toBe(0.8);
    expect(store.selectedItem?.colorOverrides).toEqual({
      main: { bg1: 'obj1' },
    });
  });

  it('supports a bound corner resize and notifies observers with the final scale and center', () => {
    const store = new SceneStore();
    store.addItem('book');
    const observed: string[] = [];
    const dispose = autorun(() => {
      const item = store.selectedItem!;
      observed.push(`${item.scale}/${item.x}/${item.y}`);
    });
    const { resizeItem } = store;
    resizeItem(store.selectedItemId!, 0.7, { x: 600, y: 550 });
    dispose();
    expect(observed).toEqual(['0.35/500/500', '0.7/600/550']);
  });

  it('does nothing without selection and rejects invalid resizes without replacing the scene', () => {
    const store = new SceneStore();
    const empty = store.scene;
    store.setSelectedScale(Number.NaN);
    expect(store.scene).toBe(empty);
    store.addItem('book');
    const populated = store.scene;
    const selectedId = store.selectedItemId!;
    expect(() => store.setSelectedScale(0)).toThrow(/positive finite/);
    expect(() => store.resizeItem('absent', 1)).toThrow(/Unknown scene item/);
    expect(() =>
      store.resizeItem(selectedId, 1, { x: 0, y: Number.NaN }),
    ).toThrow(/finite/);
    expect(store.scene).toBe(populated);
    expect(store.selectedItemId).toBe(selectedId);
    store.selectItem(null);
    store.setSelectedScale(2);
    expect(store.scene).toBe(populated);
  });
});

describe('SceneStore independent canvas and palette', () => {
  it.each(
    CANVAS_IDS.flatMap((canvasId) =>
      SCHEME_IDS.map((schemeId) => ({ canvasId, schemeId })),
    ),
  )(
    'selects $canvasId and $schemeId without changing objects or selection',
    ({ canvasId, schemeId }) => {
      const store = new SceneStore(
        addSceneItem(createScene(), {
          ...createSceneItem('wallet', 'custom'),
          x: 321,
          y: -123,
          size: 'S',
          scale: 0.8,
          rotation: 37,
          colorOverrides: { main: { bg1: 'obj1' } },
        }),
      );
      store.addItem('book');
      store.selectItem('custom');
      const before = store.scene.items.map((item) => ({ ...item }));
      const selected = store.selectedItem;
      store.setCanvas(canvasId);
      expect(store.scene.schemeId).toBe('purple');
      expect(store.scene.canvasId).toBe(canvasId);
      store.setScheme(schemeId);
      expect(store.scene.canvasId).toBe(canvasId);
      expect(store.scene.schemeId).toBe(schemeId);
      expect(store.scene.items).toEqual(before);
      expect(store.selectedItemId).toBe('custom');
      expect(store.selectedItem).toBe(selected);
      expect(store.scene.width).toBe(1000);
      expect(store.scene.height).toBe(1000);
    },
  );

  it('preserves an initial canvas while changing the palette and binds observable canvas actions', () => {
    const store = new SceneStore({ ...createScene(), canvasId: 'canvas3' });
    const observed: string[] = [];
    const dispose = autorun(() => {
      observed.push(`${store.scene.canvasId}/${store.scene.schemeId}`);
    });
    const { setCanvas, setScheme } = store;
    setScheme('orange');
    setCanvas('canvas2');
    setScheme('teal');
    dispose();
    expect(observed).toEqual([
      'canvas3/purple',
      'canvas3/orange',
      'canvas2/orange',
      'canvas2/teal',
    ]);
    expect(store.selectedItemId).toBeNull();
  });

  it('rejects invalid canvas inputs without replacing the scene or clearing selection', () => {
    const store = new SceneStore();
    store.addItem('wallet');
    const before = store.scene;
    const selected = store.selectedItem;
    expect(() => store.setCanvas('book' as CanvasId)).toThrow(
      /Unknown canvas asset/,
    );
    expect(() => store.setCanvas(undefined as unknown as CanvasId)).toThrow(
      /Unknown canvas asset/,
    );
    expect(store.scene).toBe(before);
    expect(store.selectedItem).toBe(selected);
    expect(store.selectedItemId).toBe(selected?.id);
    expect(
      () =>
        new SceneStore({ ...createScene(), canvasId: 'missing' as CanvasId }),
    ).toThrow(/Unknown canvas asset/);
  });
});

describe('SceneStore layer order', () => {
  function populatedStore(): SceneStore {
    const store = new SceneStore({
      ...createScene(),
      canvasId: 'canvas3',
      schemeId: 'orange',
      items: [
        {
          ...createSceneItem('wallet', 'custom'),
          x: -100,
          y: 700,
          size: 'S',
          scale: 0.8,
          rotation: -35,
          colorOverrides: { main: { bg1: 'obj1' } },
        },
      ],
    });
    store.addItem('book');
    store.addItem('wallet');
    return store;
  }

  it('has no layer and disabled step actions without a selection', () => {
    const store = new SceneStore();
    const before = store.scene;
    expect(store.selectedLayer).toBeNull();
    expect(store.canRaiseSelected).toBe(false);
    expect(store.canLowerSelected).toBe(false);
    store.setSelectedLayer(Number.NaN);
    store.moveSelectedLayer('up');
    store.moveSelectedLayer('down');
    expect(store.scene).toBe(before);
    store.addItem('book');
    store.selectItem(null);
    const populated = store.scene;
    store.setSelectedLayer(100);
    store.moveSelectedLayer('up');
    store.moveSelectedLayer('down');
    expect(store.scene).toBe(populated);
    expect(store.selectedLayer).toBeNull();
    expect(store.canRaiseSelected).toBe(false);
    expect(store.canLowerSelected).toBe(false);
  });

  it('moves selected layers one step, preserves selection and object properties, and stops at boundaries', () => {
    const store = populatedStore();
    store.selectItem('custom');
    const selected = store.selectedItem;
    const before = toJS(store.scene.items);
    expect(store.selectedLayer).toBe(1);
    expect(store.canLowerSelected).toBe(false);
    expect(store.canRaiseSelected).toBe(true);
    const bottom = store.scene;
    store.moveSelectedLayer('down');
    expect(store.scene).toBe(bottom);
    store.moveSelectedLayer('up');
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-1',
      'custom',
      'item-2',
    ]);
    expect(store.selectedLayer).toBe(2);
    expect(store.canLowerSelected).toBe(true);
    expect(store.canRaiseSelected).toBe(true);
    store.moveSelectedLayer('up');
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-1',
      'item-2',
      'custom',
    ]);
    expect(store.selectedLayer).toBe(3);
    expect(store.canRaiseSelected).toBe(false);
    const top = store.scene;
    store.moveSelectedLayer('up');
    expect(store.scene).toBe(top);
    store.moveSelectedLayer('down');
    expect(store.selectedLayer).toBe(2);
    expect(store.selectedItemId).toBe('custom');
    expect(store.selectedItem).toBe(selected);
    expect(store.selectedItem).toEqual(before[0]);
    expect(store.scene.items.find((item) => item.id === 'item-1')).toEqual(
      before[1],
    );
    expect(store.scene.items.find((item) => item.id === 'item-2')).toEqual(
      before[2],
    );
    expect(store.scene.canvasId).toBe('canvas3');
    expect(store.scene.schemeId).toBe('orange');
  });

  it('can move an unselected instance without replacing or selecting the current object', () => {
    const store = populatedStore();
    const selected = store.selectedItem;
    const selectedId = store.selectedItemId;
    store.setItemLayer('custom', 3);
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-1',
      'item-2',
      'custom',
    ]);
    expect(store.selectedItemId).toBe(selectedId);
    expect(store.selectedItem).toBe(selected);
    expect(store.selectedLayer).toBe(2);
    store.selectItem(null);
    store.setItemLayer('custom', 1);
    expect(store.scene.items[0].id).toBe('custom');
    expect(store.selectedItemId).toBeNull();
  });

  it('sets absolute layers and does not replace the scene for the current layer', () => {
    const store = populatedStore();
    store.setSelectedLayer(1);
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-2',
      'custom',
      'item-1',
    ]);
    expect(store.selectedLayer).toBe(1);
    const current = store.scene;
    store.setSelectedLayer(1);
    store.setItemLayer('item-2', 1);
    expect(store.scene).toBe(current);
    store.setSelectedLayer(3);
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'custom',
      'item-1',
      'item-2',
    ]);
    expect(store.selectedLayer).toBe(3);
  });

  it('adds at the top and compacts numbers after deleting an intermediate layer', () => {
    const store = populatedStore();
    store.selectItem('custom');
    store.setSelectedLayer(2);
    store.addItem('phone');
    const newId = store.selectedItemId!;
    expect(store.selectedLayer).toBe(4);
    expect(store.scene.items.at(-1)?.id).toBe(newId);
    store.selectItem('custom');
    store.deleteSelectedItem();
    expect(store.selectedLayer).toBeNull();
    expect(store.canRaiseSelected).toBe(false);
    expect(store.canLowerSelected).toBe(false);
    store.selectItem(newId);
    expect(store.selectedLayer).toBe(3);
    store.moveSelectedLayer('down');
    expect(store.selectedLayer).toBe(2);
  });

  it.each([
    0,
    -1,
    4,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects invalid layer %s atomically', (layer) => {
    const store = populatedStore();
    const before = store.scene;
    const selectedId = store.selectedItemId;
    const selected = store.selectedItem;
    expect(() => store.setSelectedLayer(layer)).toThrow(
      /layer must be an integer/,
    );
    expect(() => store.setItemLayer('custom', layer)).toThrow(
      /layer must be an integer/,
    );
    expect(store.scene).toBe(before);
    expect(store.selectedItemId).toBe(selectedId);
    expect(store.selectedItem).toBe(selected);
  });

  it('rejects unknown instances without changing the scene or selection', () => {
    const store = populatedStore();
    const before = store.scene;
    const selected = store.selectedItem;
    expect(() => store.setItemLayer('missing', 1)).toThrow(
      /Unknown scene item: missing/,
    );
    expect(store.scene).toBe(before);
    expect(store.selectedItem).toBe(selected);
  });

  it('notifies observers once per bound layer action and reflects current selection and boundaries', () => {
    const store = populatedStore();
    const observed: string[] = [];
    const dispose = autorun(() => {
      observed.push(
        `${store.scene.items.map((item) => item.id).join(',')}/${store.selectedLayer}/${store.canRaiseSelected}/${store.canLowerSelected}`,
      );
    });
    const { setItemLayer, setSelectedLayer, moveSelectedLayer, selectItem } =
      store;
    setSelectedLayer(1);
    moveSelectedLayer('up');
    setItemLayer('custom', 3);
    selectItem(null);
    dispose();
    expect(observed).toEqual([
      'custom,item-1,item-2/3/false/true',
      'item-2,custom,item-1/1/true/false',
      'custom,item-2,item-1/2/true/true',
      'item-2,item-1,custom/1/true/false',
      'item-2,item-1,custom/null/false/false',
    ]);
  });
});

describe('SceneStore rotation', () => {
  it('rotates only the selected object, keeping its center, scale, detail, colors, and order', () => {
    const store = new SceneStore({
      ...createScene(),
      canvasId: 'canvas2',
      schemeId: 'teal',
      items: [
        {
          ...createSceneItem('wallet', 'selected'),
          x: -100,
          y: 1200,
          scale: 0.72,
          rotation: 350,
          size: 'S',
          role: 'bg',
          colorOverrides: { main: { bg1: 'obj1' }, bg: { bg1: 'bg3' } },
        },
        createSceneItem('wallet', 'other'),
      ],
    });
    store.selectItem('selected');
    const selected = toJS(store.selectedItem!);
    const other = store.scene.items[1];
    const colors = store.selectedItem!.colorOverrides;
    store.rotateSelected('clockwise');
    expect(store.selectedItem).toEqual({ ...selected, rotation: 5 });
    expect(store.selectedItemId).toBe('selected');
    expect(store.selectedItem!.colorOverrides).toBe(colors);
    expect(store.scene.items[1]).toBe(other);
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'selected',
      'other',
    ]);
    expect(store.scene.canvasId).toBe('canvas2');
    expect(store.scene.schemeId).toBe('teal');
    store.rotateSelected('counterclockwise');
    expect(store.selectedItem).toEqual(selected);
  });

  it('wraps complete turns and reverses the rotation direction', () => {
    const store = new SceneStore();
    store.addItem('book');
    store.rotateSelected('counterclockwise');
    expect(store.selectedItem?.rotation).toBe(360 - ROTATION_STEP);
    store.rotateSelected('clockwise');
    expect(store.selectedItem?.rotation).toBe(0);
    for (let step = 0; step < 360 / ROTATION_STEP; step += 1) {
      store.rotateSelected('clockwise');
    }
    expect(store.selectedItem?.rotation).toBe(0);
    for (let step = 0; step < 360 / ROTATION_STEP; step += 1) {
      store.rotateSelected('counterclockwise');
    }
    expect(store.selectedItem?.rotation).toBe(0);
  });

  it('does nothing without a selection and rejects an unknown direction atomically', () => {
    const store = new SceneStore();
    const empty = store.scene;
    store.rotateSelected('clockwise');
    store.rotateSelected('counterclockwise');
    expect(store.scene).toBe(empty);
    store.addItem('book');
    const before = store.scene;
    const selectedId = store.selectedItemId;
    expect(() => store.rotateSelected('diagonal' as RotationDirection)).toThrow(
      /Unknown rotation direction/,
    );
    expect(store.scene).toBe(before);
    expect(store.selectedItemId).toBe(selectedId);
    store.selectItem(null);
    store.rotateSelected('clockwise');
    store.rotateSelected('counterclockwise');
    expect(store.scene).toBe(before);
  });

  it('binds rotation actions and notifies observers once with each final angle', () => {
    const store = new SceneStore();
    store.addItem('book');
    const observed: number[] = [];
    const dispose = autorun(() => {
      observed.push(store.selectedItem!.rotation);
    });
    const { rotateSelected } = store;
    rotateSelected('clockwise');
    rotateSelected('clockwise');
    rotateSelected('counterclockwise');
    dispose();
    expect(observed).toEqual([0, 15, 30, 15]);
  });
});

describe('SceneStore session palettes', () => {
  const builtins = builtinSchemes as ColorScheme[];

  it('accepts palettes registered after construction and preserves canvas, objects, and selection', () => {
    const schemes = new SchemeStore(builtins);
    const store = new SceneStore(undefined, undefined, () => schemes.schemes);
    store.addItem('wallet');
    store.setCanvas('canvas3');
    store.setSelectedColor('bg1', 'obj1');
    const selected = store.selectedItem;
    const items = store.scene.items;
    const id = schemes.addScheme('Custom', { ...builtins[0].colors });
    store.setScheme(id);
    expect(store.scene.schemeId).toBe(id);
    expect(store.scene.canvasId).toBe('canvas3');
    expect(store.scene.items).toBe(items);
    expect(store.selectedItem).toBe(selected);
    expect(store.selectedItem?.colorOverrides).toEqual({
      main: { bg1: 'obj1' },
    });
    store.setScheme('orange');
    expect(store.scene.schemeId).toBe('orange');
    expect(store.scene.items).toBe(items);
  });

  it('requires a registered palette for a supplied custom initial scene', () => {
    const scheme = createCustomScheme(
      'custom-scheme-initial',
      'Initial',
      builtins[0].colors,
    );
    const initial = {
      ...createScene(),
      canvasId: 'canvas2' as const,
      schemeId: scheme.id,
      items: [createSceneItem('book', 'supplied')],
    };
    expect(() => new SceneStore(initial)).toThrow(/registered scheme catalog/);
    expect(() => new SceneStore(initial, undefined, () => builtins)).toThrow(
      /color scheme/,
    );
    const store = new SceneStore(initial, undefined, () => [
      ...builtins,
      scheme,
    ]);
    expect(store.scene.schemeId).toBe(scheme.id);
    expect(store.scene.canvasId).toBe('canvas2');
    store.selectItem('supplied');
    store.moveItem('supplied', { x: 21, y: 43 });
    store.setSelectedSize('S');
    store.rotateSelected('clockwise');
    expect(store.selectedItem).toMatchObject({
      x: 21,
      y: 43,
      size: 'S',
      rotation: ROTATION_STEP,
    });
    expect(initial.items[0]).toMatchObject({
      x: 500,
      y: 500,
      size: 'L',
      rotation: 0,
    });
  });

  it('rejects absent, ambiguous, or unsafe registrations before replacing the scene', () => {
    const scheme = createCustomScheme(
      'custom-scheme-valid',
      'Valid',
      builtins[0].colors,
    );
    let registry: readonly ColorScheme[] = builtins;
    const store = new SceneStore(undefined, undefined, () => registry);
    store.addItem('book');
    const initial = store.scene;
    const selected = store.selectedItem;
    expect(() => store.setScheme(scheme.id)).toThrow(/color scheme/);
    registry = builtins.filter((entry) => entry.id !== 'orange');
    expect(() => store.setScheme('orange')).toThrow(/color scheme/);
    registry = [...builtins, scheme, scheme];
    expect(() => store.setScheme(scheme.id)).toThrow(/ambiguous color scheme/);
    registry = [...builtins, { ...scheme, id: 'unsafe palette' as SchemeId }];
    expect(() => store.setScheme('unsafe palette' as SchemeId)).toThrow(
      /color scheme/,
    );
    expect(store.scene).toBe(initial);
    expect(store.selectedItem).toBe(selected);
    expect(
      () =>
        new SceneStore(undefined, undefined, () => [...builtins, builtins[0]]),
    ).toThrow(/ambiguous color scheme/);
    expect(() => new SceneStore().setScheme(scheme.id)).toThrow(
      /registered scheme catalog/,
    );
  });

  it('keeps imported objects editable and export-ready after choosing a custom scheme', () => {
    const schemes = new SchemeStore(builtins);
    const library = new LibraryStore({ version: 1, assets: [] });
    const store = new SceneStore(
      undefined,
      () => library.manifest,
      () => schemes.schemes,
    );
    const schemeId = schemes.addScheme('Imported colors', builtins[0].colors);
    store.setScheme(schemeId);
    const assetId = library.importObject(
      'My shape',
      inspectImportedSvg(
        '<svg viewBox="0 0 40 20"><path fill="red" d="M0 0h40v20H0z"/></svg>',
      ),
      { '#FF0000': 'obj1', '#000000': 'black' },
      schemeId,
    );
    store.addItem(assetId);
    const first = store.selectedItemId!;
    store.addItem(assetId);
    const second = store.selectedItemId!;
    store.selectItem(first);
    store.moveItem(first, { x: -12, y: 600 });
    store.setSelectedScale(2);
    store.rotateSelected('counterclockwise');
    store.setSelectedLayer(2);
    store.setSelectedRole('bg');
    store.setSelectedColor('bg1', 'bg3');
    expect(store.selectedItem).toMatchObject({
      id: first,
      assetId,
      x: -12,
      y: 600,
      scale: 2,
      rotation: 360 - ROTATION_STEP,
      role: 'bg',
      colorOverrides: { bg: { bg1: 'bg3' } },
    });
    expect(store.scene.schemeId).toBe(schemeId);
    expect(store.scene.items.map((item) => item.id)).toEqual([second, first]);
    store.setScheme('teal');
    store.deleteSelectedItem();
    expect(store.scene.items.map((item) => item.id)).toEqual([second]);
    expect(library.manifest.assets[0].sourceScheme).toBe(schemeId);
  });
});
