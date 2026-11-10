import { describe, expect, it } from 'vitest';
import type { ColorRole } from './colors';
import {
  CANVAS_IDS,
  SCHEME_IDS,
  type AssetSize,
  type CanvasId,
  type SchemeId,
} from './library';
import {
  addSceneItem,
  assertScene,
  cloneSceneItem,
  createScene,
  createSceneItem,
  getSceneItemLayer,
  moveSceneItem,
  removeSceneItem,
  rotateSceneItem,
  resizeSceneItem,
  resetSceneItemColors,
  setSceneCanvas,
  setSceneItemSize,
  setSceneItemColor,
  setSceneItemRole,
  setSceneItemLayer,
  setSceneScheme,
  type ObjectId,
  type Scene,
  type SceneItem,
  type SceneRole,
} from './scene';

function populatedScene(): Scene {
  const first = {
    ...createSceneItem('book', 'item-1'),
    x: 247,
    y: 812,
    scale: 0.725,
    rotation: -32,
  };
  const second = createSceneItem('vase', 'item-2');
  return addSceneItem(addSceneItem(createScene(), first), second);
}

function freezeScene(scene: Scene): Scene {
  scene.items.forEach(Object.freeze);
  Object.freeze(scene.items);
  Object.freeze(scene);
  return scene;
}

describe('scene domain', () => {
  it('starts with an independent square scene and purple palette', () => {
    expect(createScene()).toEqual({
      width: 1000,
      height: 1000,
      canvasId: 'canvas1',
      schemeId: 'purple',
      items: [],
    });
    const first = createScene();
    first.items.push(createSceneItem('book', 'example'));
    expect(createScene().items).toEqual([]);
  });

  it('creates a centered L object at the standard library scale', () => {
    expect(createSceneItem('book', 'item-1')).toEqual({
      id: 'item-1',
      assetId: 'book',
      size: 'L',
      role: 'main',
      x: 500,
      y: 500,
      scale: 0.35,
      rotation: 0,
    });
  });

  it('adds independent instances without changing the inputs', () => {
    const original = freezeScene(createScene());
    const item = createSceneItem('book', 'first');
    const added = addSceneItem(original, item);
    const repeated = addSceneItem(added, createSceneItem('book', 'second'));
    item.x = 42;
    expect(original.items).toEqual([]);
    expect(added.items).toHaveLength(1);
    expect(added.items[0].x).toBe(500);
    expect(repeated.items.map((current) => current.assetId)).toEqual([
      'book',
      'book',
    ]);
  });

  it('changes only one instance size while preserving mixed sizes, poses, colors, and order', () => {
    const original = freezeScene(
      addSceneItem(
        setSceneItemColor(
          setSceneItemRole(populatedScene(), 'item-1', 'bg'),
          'item-1',
          'bg1',
          'bg2',
        ),
        createSceneItem('book', 'item-3'),
      ),
    );
    const small = setSceneItemSize(original, 'item-1', 'S');
    expect(small.items.map((item) => item.size)).toEqual(['S', 'L', 'L']);
    expect(small.items[0]).toEqual({ ...original.items[0], size: 'S' });
    expect(small.items[0]).not.toBe(original.items[0]);
    expect(small.items[1]).toBe(original.items[1]);
    expect(small.items[2]).toBe(original.items[2]);
    expect(original.items.map((item) => item.size)).toEqual(['L', 'L', 'L']);
    const orange = setSceneScheme(small, 'orange');
    expect(orange.items).toBe(small.items);
    expect(orange.schemeId).toBe('orange');
    const restored = setSceneItemSize(orange, 'item-1', 'L');
    expect(restored.items).toEqual(original.items);
    expect(restored.width).toBe(original.width);
    expect(restored.height).toBe(original.height);
    expect(original.schemeId).toBe('purple');
  });

  it('preserves a supplied S size when cloning and adding an object', () => {
    const item: SceneItem = {
      ...createSceneItem('wallet', 'small'),
      size: 'S',
      colorOverrides: { main: { bg1: 'obj1' } },
    };
    const cloned = cloneSceneItem(item);
    const added = addSceneItem(createScene(), item);
    expect(cloned).toEqual(item);
    expect(cloned).not.toBe(item);
    expect(cloned.colorOverrides?.main).not.toBe(item.colorOverrides?.main);
    expect(added.items[0]).toEqual(item);
    expect(added.items[0]).not.toBe(item);
  });

  it('changes only the requested role and preserves every pose', () => {
    const original = freezeScene(populatedScene());
    const updated = setSceneItemRole(original, 'item-1', 'bg');
    expect(updated.items[0]).toEqual({ ...original.items[0], role: 'bg' });
    expect(updated.items[1]).toEqual(original.items[1]);
    expect(original.items[0].role).toBe('main');
    expect(setSceneItemRole(updated, 'item-1', 'main')).toEqual(original);
  });

  it('moves only one instance with absolute coordinates without mutating any input', () => {
    const original = freezeScene(
      setSceneItemRole(
        setSceneScheme(
          setSceneItemSize(populatedScene(), 'item-1', 'S'),
          'orange',
        ),
        'item-1',
        'bg',
      ),
    );
    const position = Object.freeze({ x: -1200, y: 1000000 });
    const moved = moveSceneItem(original, 'item-1', position);

    expect(moved).toEqual({
      ...original,
      items: [
        { ...original.items[0], x: -1200, y: 1000000 },
        original.items[1],
      ],
    });
    expect(moved).not.toBe(original);
    expect(moved.items).not.toBe(original.items);
    expect(moved.items[0]).not.toBe(original.items[0]);
    expect(moved.items[1]).toBe(original.items[1]);
    expect(original.items[0]).toMatchObject({ x: 247, y: 812 });
    expect(position).toEqual({ x: -1200, y: 1000000 });
  });

  it.each([
    { x: Number.NaN, y: 0 },
    { x: Number.POSITIVE_INFINITY, y: 0 },
    { x: Number.NEGATIVE_INFINITY, y: 0 },
    { x: 0, y: Number.NaN },
    { x: 0, y: Number.POSITIVE_INFINITY },
    { x: 0, y: Number.NEGATIVE_INFINITY },
  ])(
    'rejects a nonfinite destination %j without changing the scene',
    (position) => {
      const original = freezeScene(populatedScene());
      expect(() => moveSceneItem(original, 'item-1', position)).toThrow(
        /finite/,
      );
      expect(original.items[0]).toMatchObject({ x: 247, y: 812 });
    },
  );

  it('removes only the requested instance while preserving remaining poses and order', () => {
    const scene = addSceneItem(
      setSceneScheme(setSceneItemSize(populatedScene(), 'item-1', 'S'), 'teal'),
      { ...createSceneItem('book', 'item-3'), role: 'bg' },
    );
    const original = freezeScene(scene);
    const removed = removeSceneItem(original, 'item-1');

    expect(removed).toEqual({ ...original, items: original.items.slice(1) });
    expect(removed).not.toBe(original);
    expect(removed.items).not.toBe(original.items);
    expect(removed.items[0]).toBe(original.items[1]);
    expect(removed.items[1]).toBe(original.items[2]);
    expect(original.items.map((item) => item.id)).toEqual([
      'item-1',
      'item-2',
      'item-3',
    ]);
    expect(removed.items[1].assetId).toBe('book');
  });

  it('allows removing the final item and reports missing IDs explicitly', () => {
    const onlyItem = addSceneItem(
      createScene(),
      createSceneItem('book', 'only'),
    );
    expect(removeSceneItem(onlyItem, 'only')).toEqual(createScene());
    const original = freezeScene(populatedScene());
    expect(() => moveSceneItem(original, 'missing', { x: 1, y: 2 })).toThrow(
      /Unknown scene item: missing/,
    );
    expect(() => removeSceneItem(original, 'missing')).toThrow(
      /Unknown scene item: missing/,
    );
    expect(() => removeSceneItem(createScene(), 'missing')).toThrow(
      /Unknown scene item: missing/,
    );
  });

  it.each(['', 'bad id', '1number', 'url(#clip)', 'x:y'])(
    'rejects unsafe instance ID %j',
    (id) => {
      expect(() => createSceneItem('book', id)).toThrow(/identifier/);
    },
  );

  it.each(['canvas1', 'canvas2', 'unknown'])(
    'rejects a non-object asset %s',
    (id) => {
      expect(() => createSceneItem(id as ObjectId, 'valid')).toThrow(
        /Unknown object/,
      );
    },
  );

  it.each([
    { scale: 0 },
    { scale: -1 },
    { scale: Number.NaN },
    { scale: Number.POSITIVE_INFINITY },
    { x: Number.NaN },
    { y: Number.NEGATIVE_INFINITY },
    { rotation: Number.POSITIVE_INFINITY },
    { role: 'unknown' as SceneRole },
    { size: 'M' as AssetSize },
    { size: undefined as unknown as AssetSize },
  ] satisfies Partial<SceneItem>[])(
    'rejects invalid item properties %j',
    (properties) => {
      const item = { ...createSceneItem('book', 'valid'), ...properties };
      expect(() => addSceneItem(createScene(), item)).toThrow();
    },
  );

  it('rejects duplicate IDs and invalid scene settings', () => {
    const original = populatedScene();
    expect(() =>
      addSceneItem(original, createSceneItem('phone', 'item-1')),
    ).toThrow(/Duplicate/);
    expect(() => assertScene({ ...original, width: 0 })).toThrow(/dimensions/);
    expect(() =>
      assertScene({ ...original, height: Number.POSITIVE_INFINITY }),
    ).toThrow(/dimensions/);
    expect(() =>
      assertScene({
        ...original,
        items: [...original.items, original.items[0]],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      setSceneItemSize(original, 'item-1', 'M' as AssetSize),
    ).toThrow(/object size/);
    expect(() => setSceneItemSize(original, 'absent', 'S')).toThrow(
      /Unknown scene item/,
    );
    expect(() =>
      assertScene({
        ...original,
        items: [{ ...original.items[0], size: 'M' as AssetSize }],
      }),
    ).toThrow(/object size/);
    expect(() => setSceneScheme(original, 'pink' as SchemeId)).toThrow(
      /color scheme/,
    );
    expect(() => setSceneItemRole(original, 'absent', 'bg')).toThrow(
      /Unknown scene item/,
    );
    expect(() =>
      setSceneItemRole(original, 'item-1', 'other' as SceneRole),
    ).toThrow(/Unknown scene role/);
  });
});

describe('scene item color overrides', () => {
  it('changes one instance immutably and keeps the overrides through size, scheme, and position changes', () => {
    const original = freezeScene(populatedScene());
    const colored = setSceneItemColor(original, 'item-1', 'bg1', 'obj1');
    expect(colored.items[0]).toEqual({
      ...original.items[0],
      colorOverrides: { main: { bg1: 'obj1' } },
    });
    expect(colored.items[1]).toBe(original.items[1]);
    expect(original.items[0].colorOverrides).toBeUndefined();
    const updated = moveSceneItem(
      setSceneItemSize(setSceneScheme(colored, 'teal'), 'item-1', 'S'),
      'item-1',
      { x: -15, y: 45 },
    );
    expect(updated.items[0].colorOverrides).toEqual({ main: { bg1: 'obj1' } });
    expect(updated.items[0]).toMatchObject({ scale: 0.725, rotation: -32 });
  });

  it('keeps independent main and background choices when switching roles and resetting', () => {
    const main = setSceneItemColor(populatedScene(), 'item-1', 'bg1', 'obj1');
    const background = setSceneItemColor(
      setSceneItemRole(main, 'item-1', 'bg'),
      'item-1',
      'bg1',
      'bg2',
    );
    expect(background.items[0].colorOverrides).toEqual({
      main: { bg1: 'obj1' },
      bg: { bg1: 'bg2' },
    });
    const mainAgain = setSceneItemRole(background, 'item-1', 'main');
    expect(mainAgain.items[0].colorOverrides).toEqual(
      background.items[0].colorOverrides,
    );
    const resetMain = resetSceneItemColors(mainAgain, 'item-1');
    expect(resetMain.items[0].colorOverrides).toEqual({ bg: { bg1: 'bg2' } });
    const resetBg = resetSceneItemColors(
      setSceneItemRole(resetMain, 'item-1', 'bg'),
      'item-1',
    );
    expect(resetBg.items[0].colorOverrides).toBeUndefined();
    expect(background.items[0].colorOverrides).toEqual({
      main: { bg1: 'obj1' },
      bg: { bg1: 'bg2' },
    });
  });

  it('returns a source color to its original role without losing other replacements', () => {
    let colored = setSceneItemColor(populatedScene(), 'item-1', 'bg1', 'obj1');
    colored = setSceneItemColor(colored, 'item-1', 'bg2', 'obj2');
    const resetOne = setSceneItemColor(colored, 'item-1', 'bg1', 'bg1');
    expect(resetOne.items[0].colorOverrides).toEqual({ main: { bg2: 'obj2' } });
    expect(
      setSceneItemColor(resetOne, 'item-1', 'bg2', 'bg2').items[0]
        .colorOverrides,
    ).toBeUndefined();
    expect(colored.items[0].colorOverrides).toEqual({
      main: { bg1: 'obj1', bg2: 'obj2' },
    });
  });

  it('never mutates nested input maps and copies override maps when adding instances', () => {
    const maps: NonNullable<SceneItem['colorOverrides']> = {
      main: { bg1: 'obj1' },
      bg: { bg1: 'bg2' },
    };
    const first = {
      ...createSceneItem('wallet', 'first'),
      colorOverrides: maps,
    };
    const second = {
      ...createSceneItem('wallet', 'second'),
      colorOverrides: maps,
    };
    const added = addSceneItem(addSceneItem(createScene(), first), second);
    maps.main!.bg1 = 'obj3';
    maps.bg!.bg1 = 'bg3';
    expect(added.items[0].colorOverrides).toEqual({
      main: { bg1: 'obj1' },
      bg: { bg1: 'bg2' },
    });
    expect(added.items[1].colorOverrides?.main).not.toBe(
      added.items[0].colorOverrides?.main,
    );
    Object.freeze(added.items[0].colorOverrides!.main);
    Object.freeze(added.items[0].colorOverrides!.bg);
    Object.freeze(added.items[0].colorOverrides);
    freezeScene(added);
    const changed = setSceneItemColor(added, 'first', 'bg1', 'obj2');
    const reset = resetSceneItemColors(added, 'first');
    expect(changed.items[0].colorOverrides).toEqual({
      main: { bg1: 'obj2' },
      bg: { bg1: 'bg2' },
    });
    expect(reset.items[0].colorOverrides).toEqual({ bg: { bg1: 'bg2' } });
    expect(changed.items[1]).toBe(added.items[1]);
  });

  it('checks inactive overrides and rejects unknown role containers', () => {
    const item = createSceneItem('wallet', 'first');
    const invalid = [
      { bg: { bg1: 'obj1' } },
      { main: { black: 'obj1' } },
      { main: { bg1: 'white' } },
      { other: { bg1: 'bg2' } },
      null,
      [],
    ];
    for (const colorOverrides of invalid) {
      expect(() =>
        assertScene({
          ...createScene(),
          items: [
            {
              ...item,
              colorOverrides: colorOverrides as SceneItem['colorOverrides'],
            },
          ],
        }),
      ).toThrow();
    }
  });

  it('rejects forbidden replacements and missing IDs without changing existing colors', () => {
    const original = setSceneItemColor(
      populatedScene(),
      'item-1',
      'bg1',
      'obj1',
    );
    const mainBefore = structuredClone(original);
    for (const [source, target] of [
      ['black', 'obj1'],
      ['bg1', 'white'],
      ['unknown', 'bg1'],
    ] as ColorRole[][]) {
      expect(() =>
        setSceneItemColor(original, 'item-1', source, target),
      ).toThrow();
    }
    const background = setSceneItemRole(original, 'item-1', 'bg');
    expect(() =>
      setSceneItemColor(background, 'item-1', 'bg1', 'obj1'),
    ).toThrow(/not allowed/);
    expect(() =>
      setSceneItemColor(background, 'item-1', 'obj1', 'bg1'),
    ).toThrow(/not allowed/);
    expect(() => setSceneItemColor(original, 'missing', 'bg1', 'bg2')).toThrow(
      /Unknown scene item/,
    );
    expect(() => resetSceneItemColors(original, 'missing')).toThrow(
      /Unknown scene item/,
    );
    expect(original).toEqual(mainBefore);
    expect(() =>
      assertScene({
        ...createScene(),
        items: [
          {
            ...createSceneItem('book', 'id'),
            colorOverrides: {
              main: { bg1: 'invalid' as ColorRole },
            },
          },
        ],
      }),
    ).toThrow(/not allowed/);
  });
});

describe('scene item resizing', () => {
  it('resizes only one instance and preserves center, detail, rotation, colors, and order', () => {
    const original = freezeScene(
      setSceneItemColor(
        setSceneItemSize(populatedScene(), 'item-1', 'S'),
        'item-1',
        'bg1',
        'obj1',
      ),
    );
    const resized = resizeSceneItem(original, 'item-1', 1.7);
    expect(resized.items[0]).toEqual({ ...original.items[0], scale: 1.7 });
    expect(resized.items[0]).not.toBe(original.items[0]);
    expect(resized.items[1]).toBe(original.items[1]);
    expect(original.items[0].scale).toBe(0.725);
    expect(setSceneItemSize(resized, 'item-1', 'L').items[0].scale).toBe(1.7);
  });

  it('can move the center with a corner resize without changing any other item', () => {
    const original = freezeScene(populatedScene());
    const position = Object.freeze({ x: -25, y: 930 });
    const resized = resizeSceneItem(original, 'item-1', 0.12, position);
    expect(resized.items[0]).toEqual({
      ...original.items[0],
      scale: 0.12,
      x: -25,
      y: 930,
    });
    expect(resized.items[1]).toBe(original.items[1]);
    expect(original.items[0]).toMatchObject({ x: 247, y: 812, scale: 0.725 });
    expect(position).toEqual({ x: -25, y: 930 });
  });

  it.each([0, -0.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid uniform scale %s without changing the scene',
    (scale) => {
      const original = freezeScene(populatedScene());
      expect(() => resizeSceneItem(original, 'item-1', scale)).toThrow(
        /positive finite/,
      );
      expect(original.items[0].scale).toBe(0.725);
    },
  );

  it('rejects unknown IDs and invalid corner positions atomically', () => {
    const original = freezeScene(populatedScene());
    expect(() => resizeSceneItem(original, 'absent', 0.5)).toThrow(
      /Unknown scene item/,
    );
    expect(() =>
      resizeSceneItem(original, 'item-1', 0.5, { x: 0, y: Number.NaN }),
    ).toThrow(/finite/);
    expect(() =>
      resizeSceneItem(original, 'item-1', 0.5, {
        x: Number.POSITIVE_INFINITY,
        y: 0,
      }),
    ).toThrow(/finite/);
    expect(original.items[0]).toMatchObject({ x: 247, y: 812, scale: 0.725 });
  });
});

describe('independent canvas and palette selection', () => {
  const combinations = CANVAS_IDS.flatMap((canvasId) =>
    SCHEME_IDS.map((schemeId) => ({ canvasId, schemeId })),
  );

  it.each(combinations)(
    'keeps $canvasId and $schemeId independent in either update order',
    ({ canvasId, schemeId }) => {
      const original = freezeScene(
        setSceneItemColor(
          setSceneItemSize(populatedScene(), 'item-1', 'S'),
          'item-1',
          'bg1',
          'obj1',
        ),
      );
      const canvasFirst = setSceneScheme(
        setSceneCanvas(original, canvasId),
        schemeId,
      );
      const paletteFirst = setSceneCanvas(
        setSceneScheme(original, schemeId),
        canvasId,
      );
      const expected = { ...original, canvasId, schemeId };
      expect(canvasFirst).toEqual(expected);
      expect(paletteFirst).toEqual(expected);
      expect(canvasFirst.items).toBe(original.items);
      expect(paletteFirst.items).toBe(original.items);
      expect(canvasFirst).not.toBe(original);
      expect(paletteFirst).not.toBe(original);
      expect(original).toMatchObject({
        canvasId: 'canvas1',
        schemeId: 'purple',
      });
      expect(original.items[0]).toMatchObject({
        size: 'S',
        x: 247,
        y: 812,
        scale: 0.725,
        rotation: -32,
        colorOverrides: { main: { bg1: 'obj1' } },
      });
    },
  );

  it.each(['canvas4', 'book', '', undefined])(
    'rejects invalid or missing canvas %j without changing the scene',
    (value) => {
      const original = freezeScene(populatedScene());
      const canvasId = value as CanvasId;
      expect(() => setSceneCanvas(original, canvasId)).toThrow(
        /Unknown canvas asset/,
      );
      expect(() => assertScene({ ...original, canvasId })).toThrow(
        /Unknown canvas asset/,
      );
      expect(original.canvasId).toBe('canvas1');
      expect(original.schemeId).toBe('purple');
      expect(original.items).toHaveLength(2);
    },
  );
});

describe('scene layer order', () => {
  function layeredScene(): Scene {
    const first: SceneItem = {
      ...createSceneItem('wallet', 'first'),
      x: 123,
      y: -50,
      scale: 0.75,
      rotation: 35,
      size: 'S',
      role: 'bg',
      colorOverrides: { main: { bg1: 'obj1' }, bg: { bg1: 'bg3' } },
    };
    return {
      ...createScene(),
      canvasId: 'canvas2',
      schemeId: 'teal',
      items: [
        first,
        createSceneItem('book', 'second'),
        createSceneItem('wallet', 'third'),
        createSceneItem('pen', 'fourth'),
      ],
    };
  }

  it('numbers object layers from bottom to top without counting the canvas', () => {
    const scene = freezeScene(layeredScene());
    expect(
      ['first', 'second', 'third', 'fourth'].map((id) =>
        getSceneItemLayer(scene, id),
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(() => getSceneItemLayer(scene, 'canvas2')).toThrow(
      /Unknown scene item/,
    );
  });

  it.each([
    { id: 'first', layer: 4, order: ['second', 'third', 'fourth', 'first'] },
    { id: 'first', layer: 3, order: ['second', 'third', 'first', 'fourth'] },
    { id: 'fourth', layer: 1, order: ['fourth', 'first', 'second', 'third'] },
    { id: 'fourth', layer: 2, order: ['first', 'fourth', 'second', 'third'] },
    { id: 'second', layer: 3, order: ['first', 'third', 'second', 'fourth'] },
    { id: 'third', layer: 2, order: ['first', 'third', 'second', 'fourth'] },
  ])(
    'moves $id to layer $layer while preserving all object identities and properties',
    ({ id, layer, order }) => {
      const original = freezeScene(layeredScene());
      const before = structuredClone(original);
      const reordered = setSceneItemLayer(original, id, layer);
      expect(reordered.items.map((item) => item.id)).toEqual(order);
      expect(reordered).not.toBe(original);
      expect(reordered.items).not.toBe(original.items);
      for (const item of reordered.items) {
        expect(item).toBe(
          original.items.find((source) => source.id === item.id),
        );
      }
      expect({ ...reordered, items: original.items }).toEqual(original);
      expect(original).toEqual(before);
      expect(getSceneItemLayer(reordered, id)).toBe(layer);
    },
  );

  it('can reorder several times and return to the original order without replacing objects', () => {
    const original = freezeScene(layeredScene());
    const first = setSceneItemLayer(original, 'first', 3);
    const second = setSceneItemLayer(first, 'fourth', 1);
    const third = setSceneItemLayer(second, 'first', 1);
    const restored = setSceneItemLayer(third, 'fourth', 4);
    expect(first.items.map((item) => item.id)).toEqual([
      'second',
      'third',
      'first',
      'fourth',
    ]);
    expect(second.items.map((item) => item.id)).toEqual([
      'fourth',
      'second',
      'third',
      'first',
    ]);
    expect(third.items.map((item) => item.id)).toEqual([
      'first',
      'fourth',
      'second',
      'third',
    ]);
    expect(restored).toEqual(original);
    expect(
      restored.items.every((item, index) => item === original.items[index]),
    ).toBe(true);
  });

  it('keeps the same scene and array when the requested layer is already current', () => {
    const original = freezeScene(layeredScene());
    for (const id of ['first', 'second', 'third', 'fourth']) {
      expect(
        setSceneItemLayer(original, id, getSceneItemLayer(original, id)),
      ).toBe(original);
    }
  });

  it.each([
    0,
    -1,
    5,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects invalid layer %s without changing the scene', (layer) => {
    const original = freezeScene(layeredScene());
    const before = structuredClone(original);
    expect(() => setSceneItemLayer(original, 'second', layer)).toThrow(
      /layer must be an integer from 1 to 4/,
    );
    expect(original).toEqual(before);
  });

  it('rejects missing object IDs in populated and empty scenes', () => {
    for (const scene of [
      freezeScene(layeredScene()),
      freezeScene(createScene()),
    ]) {
      expect(() => getSceneItemLayer(scene, 'missing')).toThrow(
        /Unknown scene item: missing/,
      );
      expect(() => setSceneItemLayer(scene, 'missing', 1)).toThrow(
        /Unknown scene item: missing/,
      );
    }
  });

  it('adds new instances above reordered objects and compacts layer numbers after deletion', () => {
    const reordered = setSceneItemLayer(
      freezeScene(layeredScene()),
      'first',
      4,
    );
    const added = addSceneItem(reordered, createSceneItem('wallet', 'new'));
    expect(getSceneItemLayer(added, 'new')).toBe(5);
    expect(added.items.map((item) => item.id)).toEqual([
      'second',
      'third',
      'fourth',
      'first',
      'new',
    ]);
    const removed = removeSceneItem(added, 'third');
    expect(removed.items.map((item) => item.id)).toEqual([
      'second',
      'fourth',
      'first',
      'new',
    ]);
    expect(
      ['second', 'fourth', 'first', 'new'].map((id) =>
        getSceneItemLayer(removed, id),
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(removed.canvasId).toBe('canvas2');
    expect(removed.schemeId).toBe('teal');
  });
});

describe('session SVG objects in scenes', () => {
  it('supports imported objects through normal scene operations without changing the source', () => {
    const original = freezeScene(
      addSceneItem(createScene(), createSceneItem('custom-1', 'imported')),
    );
    const moved = moveSceneItem(original, 'imported', { x: 240, y: 320 });
    const resized = resizeSceneItem(moved, 'imported', 2);
    const recolored = setSceneItemColor(resized, 'imported', 'obj1', 'obj2');
    const withBook = addSceneItem(recolored, createSceneItem('book', 'book'));
    const reordered = setSceneItemLayer(withBook, 'imported', 2);
    const background = setSceneItemRole(reordered, 'imported', 'bg');
    expect(() => assertScene(background)).not.toThrow();
    expect(background.items[1]).toMatchObject({
      id: 'imported',
      assetId: 'custom-1',
      size: 'L',
      role: 'bg',
      x: 240,
      y: 320,
      scale: 2,
      colorOverrides: { main: { obj1: 'obj2' } },
    });
    expect(
      removeSceneItem(background, 'imported').items.map((item) => item.id),
    ).toEqual(['book']);
    expect(original.items[0]).toEqual(createSceneItem('custom-1', 'imported'));
  });

  it.each(['unregistered', 'custom-', 'custom-../1', 'custom-1<script>'])(
    'rejects invalid object identifier %s',
    (value) => {
      expect(() => createSceneItem(value as ObjectId, 'item')).toThrow(
        /Unknown object asset/,
      );
      expect(() =>
        assertScene({
          ...createScene(),
          items: [
            { ...createSceneItem('book', 'item'), assetId: value as ObjectId },
          ],
        }),
      ).toThrow(/Unknown object asset/);
    },
  );
});

describe('scene item rotation', () => {
  it.each([
    [0, 15, 15],
    [0, -15, 345],
    [350, 15, 5],
    [10, -15, 355],
    [-32, 15, 343],
    [721, -15, 346],
    [12.5, 720.25, 12.75],
    [12.5, -720.25, 12.25],
    [Number.MAX_VALUE, Number.MAX_VALUE, 256],
    [-Number.MAX_VALUE, -Number.MAX_VALUE, 104],
    [0, -Number.MIN_VALUE, 0],
  ])('normalizes %s plus %s degrees to %s', (rotation, delta, expected) => {
    const original = freezeScene({
      ...createScene(),
      items: [{ ...createSceneItem('book', 'selected'), rotation }],
    });
    const rotated = rotateSceneItem(original, 'selected', delta);
    expect(rotated.items[0].rotation).toBe(expected);
    expect(rotated.items[0].rotation).toBeGreaterThanOrEqual(0);
    expect(rotated.items[0].rotation).toBeLessThan(360);
    expect(original.items[0].rotation).toBe(rotation);
  });

  it('rotates only the requested instance and preserves geometry, layer order, detail, and color maps', () => {
    const selected: SceneItem = {
      ...createSceneItem('wallet', 'selected'),
      x: -200,
      y: 1200,
      scale: 0.85,
      rotation: 30,
      size: 'S',
      role: 'bg',
      colorOverrides: { main: { bg1: 'obj1' }, bg: { bg1: 'bg2' } },
    };
    const original = freezeScene({
      ...createScene(),
      canvasId: 'canvas3',
      schemeId: 'orange',
      items: [
        createSceneItem('book', 'bottom'),
        selected,
        createSceneItem('wallet', 'top'),
      ],
    });
    const rotated = rotateSceneItem(original, 'selected', -15);
    expect(rotated).toEqual({
      ...original,
      items: [
        original.items[0],
        { ...selected, rotation: 15 },
        original.items[2],
      ],
    });
    expect(rotated).not.toBe(original);
    expect(rotated.items).not.toBe(original.items);
    expect(rotated.items[0]).toBe(original.items[0]);
    expect(rotated.items[2]).toBe(original.items[2]);
    expect(rotated.items[1].colorOverrides).toBe(selected.colorOverrides);
    expect(selected.rotation).toBe(30);
  });

  it.each([0, 360, -360, 720, -1080])(
    'returns the original scene for a full-turn delta of %s',
    (delta) => {
      const original = freezeScene({
        ...createScene(),
        items: [{ ...createSceneItem('book', 'selected'), rotation: 35 }],
      });
      expect(rotateSceneItem(original, 'selected', delta)).toBe(original);
    },
  );

  it('normalizes an existing angle even when the requested delta is zero', () => {
    const original = freezeScene({
      ...createScene(),
      items: [{ ...createSceneItem('book', 'selected'), rotation: -25 }],
    });
    expect(rotateSceneItem(original, 'selected', 0).items[0].rotation).toBe(
      335,
    );
    expect(original.items[0].rotation).toBe(-25);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite delta %s without modifying the input',
    (delta) => {
      const original = freezeScene(populatedScene());
      const before = structuredClone(original);
      expect(() => rotateSceneItem(original, 'item-1', delta)).toThrow(
        /rotation delta must be a finite number/,
      );
      expect(original).toEqual(before);
    },
  );

  it('validates the whole scene and rejects missing items, including on zero delta', () => {
    const original = freezeScene(populatedScene());
    expect(() => rotateSceneItem(original, 'missing', 0)).toThrow(
      /Unknown scene item: missing/,
    );
    expect(() =>
      rotateSceneItem({ ...original, width: -1 }, 'item-1', 15),
    ).toThrow(/dimensions/);
    expect(() =>
      rotateSceneItem(
        {
          ...original,
          items: [
            original.items[0],
            { ...original.items[1], rotation: Number.NaN },
          ],
        },
        'item-1',
        15,
      ),
    ).toThrow(/rotation must be finite/);
  });

  it('uses the same rotation logic for a session SVG asset', () => {
    const original = freezeScene({
      ...createScene(),
      items: [createSceneItem('custom-7', 'imported')],
    });
    expect(rotateSceneItem(original, 'imported', -15).items[0]).toEqual({
      ...original.items[0],
      rotation: 345,
    });
  });
});

describe('session palettes in scenes', () => {
  it('switches to a session palette independently and preserves object references and edits', () => {
    const original = freezeScene(
      setSceneItemColor(
        setSceneCanvas(populatedScene(), 'canvas2'),
        'item-1',
        'bg1',
        'obj1',
      ),
    );
    const switched = setSceneScheme(original, 'custom-scheme-1');
    expect(switched).toEqual({ ...original, schemeId: 'custom-scheme-1' });
    expect(switched.items).toBe(original.items);
    expect(switched.canvasId).toBe('canvas2');
    expect(() => assertScene(switched)).not.toThrow();
    const moved = moveSceneItem(switched, 'item-1', { x: 100, y: 200 });
    expect(moved.schemeId).toBe('custom-scheme-1');
    expect(moved.items[0].colorOverrides).toEqual({ main: { bg1: 'obj1' } });
    expect(setSceneScheme(switched, 'teal')).toEqual({
      ...original,
      schemeId: 'teal',
    });
    expect(original.schemeId).toBe('purple');
  });

  it.each([
    'custom-scheme-',
    'custom-scheme-../1',
    'custom-scheme-a--b',
    'custom-scheme-1<script>',
  ])('rejects malformed custom scheme %s in assertions and updates', (id) => {
    const original = freezeScene(populatedScene());
    const schemeId = id as SchemeId;
    expect(() => setSceneScheme(original, schemeId)).toThrow(/color scheme/);
    expect(() => assertScene({ ...original, schemeId })).toThrow(
      /color scheme/,
    );
    expect(original.schemeId).toBe('purple');
  });
});
