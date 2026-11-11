import { describe, expect, it } from 'vitest';
import type { Point } from './geometry';
import { getSceneItemAtPoint } from './hitTest';
import type { LibraryAsset, LibraryManifest } from './library';
import {
  createScene,
  createSceneItem,
  setSceneItemLayer,
  type Scene,
  type SceneItem,
} from './scene';

function asset(size: 'L' | 'S'): LibraryAsset {
  const width = size === 'L' ? 200 : 80;
  const height = size === 'L' ? 100 : 60;
  const viewBox = size === 'L' ? '-40 30 200 100' : '20 -10 80 60';
  return {
    id: 'custom-sparse',
    size,
    kind: 'object',
    sourceScheme: 'purple',
    width,
    height,
    viewBox,
    // Most of the imported viewport is deliberately blank.
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><circle cx="${size === 'L' ? -38 : 22}" cy="${size === 'L' ? 32 : -8}" r="1"/></svg>`,
  };
}

function library(): LibraryManifest {
  return { version: 1, assets: [asset('L'), asset('S')] };
}

function object(overrides: Partial<SceneItem> = {}): SceneItem {
  return {
    ...createSceneItem('custom-sparse', 'object-one'),
    scale: 0.5,
    x: 300,
    y: 200,
    ...overrides,
  };
}

function scene(...items: SceneItem[]): Scene {
  return { ...createScene(), items };
}

function rotatePoint(item: SceneItem, localX: number, localY: number): Point {
  const angle = (item.rotation * Math.PI) / 180;
  return {
    x: item.x + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: item.y + localX * Math.sin(angle) + localY * Math.cos(angle),
  };
}

describe('scene object picking', () => {
  it('selects blank space inside an imported SVG viewport, without inspecting its paths', () => {
    const item = object();
    const source = scene(item);
    const manifest = library();
    const before = structuredClone({ source, manifest });
    expect(getSceneItemAtPoint(source, manifest, { x: 349, y: 224 })).toBe(
      item,
    );
    expect({ source, manifest }).toEqual(before);
  });

  it.each([
    { x: 250, y: 175 },
    { x: 350, y: 175 },
    { x: 250, y: 225 },
    { x: 350, y: 225 },
    { x: 300, y: 175 },
    { x: 350, y: 200 },
  ])('includes the viewport edge at $x, $y', (point) => {
    const item = object();
    expect(getSceneItemAtPoint(scene(item), library(), point)).toBe(item);
  });

  it.each([
    { x: 249.9999, y: 200 },
    { x: 350.0001, y: 200 },
    { x: 300, y: 174.9999 },
    { x: 300, y: 225.0001 },
  ])('misses a point just outside the viewport at $x, $y', (point) => {
    expect(
      getSceneItemAtPoint(scene(object()), library(), point),
    ).toBeUndefined();
  });

  it('selects the topmost viewport even in its blank area', () => {
    const bottom = object({ id: 'bottom' });
    const top = object({ id: 'top', role: 'bg' });
    const source = scene(bottom, top);
    const point = { x: 349, y: 224 };
    expect(getSceneItemAtPoint(source, library(), point)).toBe(top);
    const reordered = setSceneItemLayer(source, 'bottom', 2);
    expect(getSceneItemAtPoint(reordered, library(), point)).toBe(bottom);
    expect(source.items).toEqual([bottom, top]);
  });

  it('finds a lower viewport when a higher object does not contain the point', () => {
    const bottom = object({ id: 'bottom', scale: 1 });
    const top = object({ id: 'top', scale: 0.1 });
    expect(
      getSceneItemAtPoint(scene(bottom, top), library(), { x: 370, y: 230 }),
    ).toBe(bottom);
  });

  it.each([30, 90, 135, -45, 405])(
    'uses the actual rotated viewport at %s degrees instead of its axis-aligned box',
    (rotation) => {
      const item = object({ rotation });
      const source = scene(item);
      expect(
        getSceneItemAtPoint(source, library(), rotatePoint(item, 49, 24)),
      ).toBe(item);
      expect(
        getSceneItemAtPoint(source, library(), rotatePoint(item, 50.001, 0)),
      ).toBeUndefined();
      expect(
        getSceneItemAtPoint(source, library(), rotatePoint(item, 0, 25.001)),
      ).toBeUndefined();
      expect(
        getSceneItemAtPoint(source, library(), rotatePoint(item, 50, 25)),
      ).toBe(item);
    },
  );

  it('does not let the empty corner of a rotated axis-aligned box obscure a lower item', () => {
    const bottom = object({ id: 'bottom', scale: 2 });
    const top = object({ id: 'top', rotation: 45 });
    const point = { x: 350, y: 250 };
    expect(getSceneItemAtPoint(scene(top), library(), point)).toBeUndefined();
    expect(getSceneItemAtPoint(scene(bottom, top), library(), point)).toBe(
      bottom,
    );
  });

  it('picks independent native source viewports after manual scaling', () => {
    const large = object();
    const small = object({ size: 'S', scale: 1 });
    const manifest = library();
    expect(
      getSceneItemAtPoint(scene(large), manifest, { x: 339, y: 229 }),
    ).toBeUndefined();
    expect(
      getSceneItemAtPoint(scene(small), manifest, { x: 339, y: 229 }),
    ).toBe(small);
    const scaled = object({ size: 'S', scale: 2 });
    expect(
      getSceneItemAtPoint(scene(scaled), manifest, { x: 380, y: 260 }),
    ).toBe(scaled);
    expect(
      getSceneItemAtPoint(scene(scaled), manifest, { x: 380.001, y: 260 }),
    ).toBeUndefined();
  });

  it('works for a single imported L variant without requiring an invented S asset', () => {
    const item = object();
    expect(
      getSceneItemAtPoint(
        scene(item),
        { version: 1, assets: [asset('L')] },
        item,
      ),
    ).toBe(item);
  });

  it('never picks the canvas or empty space', () => {
    const manifest = library();
    manifest.assets.push({
      ...asset('L'),
      id: 'canvas1',
      kind: 'canvas',
      viewBox: '0 0 1000 1000',
      width: 1000,
      height: 1000,
    });
    expect(
      getSceneItemAtPoint(createScene(), manifest, { x: 500, y: 500 }),
    ).toBeUndefined();
    expect(
      getSceneItemAtPoint(scene(object()), manifest, { x: 500, y: 500 }),
    ).toBeUndefined();
  });

  it.each([
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 0, y: 1000 },
    { x: 1000, y: 1000 },
  ])(
    'includes visible object portions at the canvas boundary $x, $y',
    (point) => {
      const item = object(point);
      expect(getSceneItemAtPoint(scene(item), library(), point)).toBe(item);
    },
  );

  it.each([
    { x: -0.0001, y: 0 },
    { x: 0, y: -0.0001 },
    { x: 1000.0001, y: 0 },
    { x: 0, y: 1000.0001 },
  ])('does not pick an off-canvas portion at $x, $y', (point) => {
    const item = object(point);
    expect(getSceneItemAtPoint(scene(item), library(), point)).toBeUndefined();
  });

  it.each([
    { x: Number.NaN, y: 200 },
    { x: 300, y: Number.NaN },
    { x: Number.POSITIVE_INFINITY, y: 200 },
    { x: 300, y: Number.NEGATIVE_INFINITY },
  ])('treats non-finite pointer coordinates as a miss: %j', (point) => {
    expect(
      getSceneItemAtPoint(scene(object()), library(), point),
    ).toBeUndefined();
  });

  it('rejects invalid scene and missing geometry rather than selecting arbitrary objects', () => {
    const item = object();
    expect(() =>
      getSceneItemAtPoint(scene({ ...item, scale: 0 }), library(), item),
    ).toThrow(/scale/);
    expect(() =>
      getSceneItemAtPoint(scene(item), { version: 1, assets: [] }, item),
    ).toThrow(/object asset/);
  });
});
