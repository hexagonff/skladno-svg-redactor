import { describe, expect, it } from 'vitest';
import type { Point } from './geometry';
import type { LibraryAsset, LibraryManifest } from './library';
import {
  getObjectGeometry,
  getObjectScaleForDimension,
  resizeObjectFromPointer,
  startObjectResize,
  type ResizeCorner,
} from './objectGeometry';
import { createSceneItem, type SceneItem } from './scene';

function asset(size: 'L' | 'S', width: number, height: number): LibraryAsset {
  return {
    id: 'wallet',
    size,
    kind: 'object',
    sourceScheme: 'purple',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    svg: `<svg><path d="${size === 'L' ? 'M0 0L2 3' : 'M1 0L0 2'}"/></svg>`,
  };
}

function library(): LibraryManifest {
  // The S artwork deliberately has a slightly different aspect ratio.
  return { version: 1, assets: [asset('L', 200, 100), asset('S', 100, 60)] };
}

function object(overrides: Partial<SceneItem> = {}): SceneItem {
  return {
    ...createSceneItem('wallet', 'wallet-one'),
    scale: 0.5,
    x: 300,
    y: 200,
    ...overrides,
  };
}

function expectPoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe('object geometry', () => {
  it('keeps independent native L and S dimensions without width normalization', () => {
    const manifest = library();
    const source = structuredClone(manifest);
    const large = getObjectGeometry(object(), manifest);
    const small = getObjectGeometry(object({ size: 'S' }), manifest);
    expect(large).toMatchObject({
      width: 100,
      height: 50,
      scale: 0.5,
      viewBox: [0, 0, 200, 100],
    });
    expect(small).toMatchObject({
      width: 50,
      height: 30,
      scale: 0.5,
      viewBox: [0, 0, 100, 60],
    });
    expect(large.asset).toBe(manifest.assets[0]);
    expect(small.asset).toBe(manifest.assets[1]);
    expect(manifest).toEqual(source);
  });

  it('keeps the native viewport dimensions and a distinct offset viewBox', () => {
    const manifest = library();
    manifest.assets[0] = {
      ...manifest.assets[0],
      width: 400,
      height: 200,
      viewBox: '-5, 7, 200, 100',
    };
    expect(getObjectGeometry(object(), manifest)).toMatchObject({
      viewBox: [-5, 7, 200, 100],
      width: 200,
      height: 100,
    });
  });

  it('couples width and height with one scale in either detail level', () => {
    const manifest = library();
    const large = object();
    const small = object({ size: 'S' });
    const widthScale = getObjectScaleForDimension(
      small,
      manifest,
      'width',
      250,
    );
    expect(widthScale).toBe(2.5);
    expect(
      getObjectGeometry({ ...small, scale: widthScale }, manifest),
    ).toMatchObject({ width: 250, height: 150 });
    const heightScale = getObjectScaleForDimension(
      small,
      manifest,
      'height',
      75,
    );
    expect(heightScale).toBe(1.25);
    expect(
      getObjectGeometry({ ...small, scale: heightScale }, manifest),
    ).toMatchObject({ width: 125, height: 75 });
    expect(getObjectScaleForDimension(large, manifest, 'height', 75)).toBe(
      0.75,
    );
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid requested dimension %s',
    (value) => {
      expect(() =>
        getObjectScaleForDimension(object(), library(), 'width', value),
      ).toThrow(/positive finite/);
    },
  );

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid source scale %s',
    (scale) => {
      expect(() => getObjectGeometry(object({ scale }), library())).toThrow(
        /positive finite/,
      );
    },
  );

  it('rejects a finite width when the coupled height would overflow', () => {
    const manifest = library();
    manifest.assets[0] = {
      ...manifest.assets[0],
      width: 1,
      height: 10,
      viewBox: '0 0 1 10',
    };
    expect(() =>
      getObjectScaleForDimension(object(), manifest, 'width', 8e307),
    ).toThrow(/dimensions/);
    expect(getObjectGeometry(object(), manifest)).toMatchObject({
      width: 0.5,
      height: 5,
      scale: 0.5,
    });
  });

  it('validates the selected source and does not require unused L metadata for S', () => {
    const manifest = library();
    const small = object({ size: 'S' });
    expect(
      getObjectGeometry(small, { version: 1, assets: [manifest.assets[1]] })
        .width,
    ).toBe(50);
    for (const assets of [
      [manifest.assets[0]],
      [...manifest.assets, manifest.assets[1]],
      [manifest.assets[0], { ...manifest.assets[1], kind: 'canvas' as const }],
    ]) {
      expect(() => getObjectGeometry(small, { version: 1, assets })).toThrow(
        /object asset/,
      );
    }
  });

  it.each([
    '0 0 0 20',
    '0 0 20 -1',
    '0 0 20 Infinity',
    '0 0 20',
    '0 0 20 30 40',
    '',
  ])('rejects invalid viewBox %j', (viewBox) => {
    const manifest = library();
    manifest.assets[1].viewBox = viewBox;
    expect(() => getObjectGeometry(object({ size: 'S' }), manifest)).toThrow(
      /Invalid SVG geometry/,
    );
  });

  it('rejects invalid native dimensions, unusable computed dimensions, and dimension names', () => {
    const manifest = library();
    manifest.assets[0].height = 0;
    expect(() => getObjectGeometry(object(), manifest)).toThrow(
      /Invalid SVG geometry/,
    );
    manifest.assets[0].height = Number.NaN;
    expect(() => getObjectGeometry(object(), manifest)).toThrow(
      /Invalid SVG geometry/,
    );
    expect(() =>
      getObjectGeometry(object({ scale: Number.MAX_VALUE }), library()),
    ).toThrow(/dimensions/);
    expect(() =>
      getObjectScaleForDimension(object(), library(), 'depth' as 'width', 20),
    ).toThrow(/Unknown object dimension/);
  });
});

describe('corner resizing', () => {
  it('resizes proportionally around the opposite corner and keeps the initial grab offset', () => {
    const item = Object.freeze(object());
    const pointer = Object.freeze({ x: 355, y: 222 });
    const gesture = startObjectResize(item, library(), 'se', pointer);
    const stationary = resizeObjectFromPointer(gesture, pointer);
    expect(stationary.scale).toBeCloseTo(0.5);
    expectPoint(stationary.position, { x: 300, y: 200 });
    const resized = resizeObjectFromPointer(gesture, { x: 405, y: 247 });
    expect(resized.scale).toBeCloseTo(0.75);
    expectPoint(resized.position, { x: 325, y: 212.5 });
    const geometry = getObjectGeometry(
      { ...item, ...resized.position, scale: resized.scale },
      library(),
    );
    expect(geometry.width).toBeCloseTo(150);
    expect(geometry.height).toBeCloseTo(75);
    expectPoint(
      {
        x: resized.position.x - geometry.width / 2,
        y: resized.position.y - geometry.height / 2,
      },
      { x: 250, y: 175 },
    );
    expect(item).toMatchObject({ x: 300, y: 200, scale: 0.5 });
    expect(pointer).toEqual({ x: 355, y: 222 });
  });

  it.each([
    ['nw', { x: 250, y: 175 }, { x: 150, y: 125 }, { x: 250, y: 175 }],
    ['ne', { x: 350, y: 175 }, { x: 450, y: 125 }, { x: 350, y: 175 }],
    ['sw', { x: 250, y: 225 }, { x: 150, y: 275 }, { x: 250, y: 225 }],
    ['se', { x: 350, y: 225 }, { x: 450, y: 275 }, { x: 350, y: 225 }],
  ] as const)(
    'supports the %s handle without flipping either axis',
    (corner, start, end, expectedCenter) => {
      const gesture = startObjectResize(object(), library(), corner, start);
      const resized = resizeObjectFromPointer(gesture, end);
      expect(resized.scale).toBeCloseTo(1);
      expectPoint(resized.position, expectedCenter);
    },
  );

  it('keeps the rotated opposite corner fixed and uses a single scale', () => {
    const item = object({ rotation: 90 });
    const gesture = startObjectResize(item, library(), 'se', {
      x: 277,
      y: 253,
    });
    const resized = resizeObjectFromPointer(gesture, { x: 302, y: 203 });
    expect(resized.scale).toBeCloseTo(0.25);
    expectPoint(resized.position, { x: 312.5, y: 175 });
    expectPoint(
      { x: resized.position.x + 12.5, y: resized.position.y - 25 },
      { x: 325, y: 150 },
    );
  });

  it('projects movement across the diagonal without stretching the object', () => {
    const gesture = startObjectResize(object(), library(), 'se', {
      x: 350,
      y: 225,
    });
    // This motion is perpendicular to the diagonal, so neither size nor center changes.
    const resized = resizeObjectFromPointer(gesture, { x: 375, y: 175 });
    expect(resized.scale).toBeCloseTo(0.5);
    expectPoint(resized.position, { x: 300, y: 200 });
  });

  it('clamps at a one-unit smaller side and never flips when crossing the anchor', () => {
    const gesture = startObjectResize(object(), library(), 'se', {
      x: 350,
      y: 225,
    });
    for (const pointer of [
      { x: 250, y: 175 },
      { x: -500, y: -800 },
    ]) {
      const resized = resizeObjectFromPointer(gesture, pointer);
      expect(resized.scale).toBeCloseTo(0.01);
      expectPoint(resized.position, { x: 251, y: 175.5 });
      expect(
        getObjectGeometry(object({ scale: resized.scale }), library()),
      ).toMatchObject({ width: 2, height: 1 });
    }
  });

  it('rejects nonfinite pointers, poses, rotation, and unsupported corners', () => {
    const manifest = library();
    const pointer = { x: 350, y: 225 };
    expect(() =>
      startObjectResize(object(), manifest, 'middle' as ResizeCorner, pointer),
    ).toThrow(/corner/);
    expect(() =>
      startObjectResize(object({ x: Number.NaN }), manifest, 'se', pointer),
    ).toThrow(/finite/);
    expect(() =>
      startObjectResize(
        object({ rotation: Number.POSITIVE_INFINITY }),
        manifest,
        'se',
        pointer,
      ),
    ).toThrow(/finite/);
    expect(() =>
      startObjectResize(object(), manifest, 'se', { x: Number.NaN, y: 0 }),
    ).toThrow(/finite/);
    const gesture = startObjectResize(object(), manifest, 'se', pointer);
    expect(() =>
      resizeObjectFromPointer(gesture, { x: 0, y: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite/);
  });
});

describe('imported SVG geometry', () => {
  function importedLibrary(): LibraryManifest {
    return {
      version: 1,
      assets: [
        {
          ...asset('L', 24, 12),
          id: 'custom-1',
          viewBox: '-12 5 24 12',
        },
      ],
    };
  }

  it('uses the single original variant and its offset viewBox without synthesizing detail', () => {
    const manifest = importedLibrary();
    const item = { ...createSceneItem('custom-1', 'imported'), scale: 10 };
    const geometry = getObjectGeometry(item, manifest);
    expect(geometry).toMatchObject({
      viewBox: [-12, 5, 24, 12],
      width: 240,
      height: 120,
      scale: 10,
    });
    expect(geometry.asset).toBe(manifest.assets[0]);
    expect(getObjectScaleForDimension(item, manifest, 'height', 60)).toBe(5);
    expect(() => getObjectGeometry({ ...item, size: 'S' }, manifest)).toThrow(
      /custom-1__S/,
    );
    expect(manifest.assets).toHaveLength(1);
  });

  it('rejects custom objects absent from the session manifest or registered with the wrong kind', () => {
    const item = createSceneItem('custom-1', 'imported');
    expect(() => getObjectGeometry(item, { version: 1, assets: [] })).toThrow(
      /object asset/,
    );
    const manifest = importedLibrary();
    manifest.assets[0].kind = 'canvas';
    expect(() => getObjectGeometry(item, manifest)).toThrow(/object asset/);
  });
});
