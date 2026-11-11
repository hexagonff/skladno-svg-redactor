import { describe, expect, it } from 'vitest';
import type { CompositionPlan } from '../../domain/composition';
import type { LibraryAsset, LibraryManifest } from '../../domain/library';
import { getObjectGeometry } from '../../domain/objectGeometry';
import {
  createScene,
  createSceneItem,
  type ObjectId,
  type Scene,
} from '../../domain/scene';
import { composeScene } from './index';

function asset(id: ObjectId, width: number, height: number): LibraryAsset {
  return {
    id,
    size: 'L',
    kind: 'object',
    sourceScheme: 'purple',
    width,
    height,
    viewBox: `-20 12 ${width} ${height}`,
    svg: '<svg/>',
  };
}
function library(): LibraryManifest {
  return {
    version: 1,
    assets: [
      asset('book', 1446, 977),
      asset('phone', 797, 462),
      asset('lamp', 946, 1129),
      asset('vase', 591, 748),
      asset('folder', 1241, 659),
      asset('pen', 509, 286),
      asset('custom-icon', 24, 12),
      {
        ...asset('book', 723, 430),
        size: 'S',
        viewBox: '37 -11 723 430',
        svg: '<svg viewBox="37 -11 723 430"><path d="M37 -11L760 419Z"/></svg>',
      },
      {
        ...asset('lamp', 473, 500),
        size: 'S',
        viewBox: '-9 21 473 500',
        svg: '<svg viewBox="-9 21 473 500"><path d="M-9 21L464 521Z"/></svg>',
      },
    ],
  };
}
function plan(): CompositionPlan {
  return {
    message: 'Книга, телефон и лампа для учёбы.',
    items: [
      { assetId: 'book', role: 'main' },
      { assetId: 'phone', role: 'main' },
      { assetId: 'lamp', role: 'bg' },
    ],
  };
}
function expectReadable(result: Scene, manifest: LibraryManifest): void {
  const bounds = result.items.map((item) => {
    const geometry = getObjectGeometry(item, manifest);
    return {
      left: item.x - geometry.width / 2,
      right: item.x + geometry.width / 2,
      top: item.y - geometry.height / 2,
      bottom: item.y + geometry.height / 2,
    };
  });
  for (const box of bounds) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(result.width);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(result.height);
  }
  for (let first = 0; first < bounds.length; first += 1) {
    for (let second = first + 1; second < bounds.length; second += 1) {
      const a = bounds[first];
      const b = bounds[second];
      expect(
        a.right < b.left ||
          b.right < a.left ||
          a.bottom < b.top ||
          b.bottom < a.top,
      ).toBe(true);
    }
  }
}

describe('fixed-size composition layout', () => {
  it('replaces objects without mutating input data or changing canvas, palette, and proportions', () => {
    const source = {
      ...createScene(),
      canvasId: 'canvas3' as const,
      schemeId: 'custom-scheme-session' as const,
      items: [
        {
          ...createSceneItem('pen', 'composition-1'),
          scale: 9,
          colorOverrides: { main: { bg1: 'obj1' as const } },
        },
      ],
    };
    const manifest = library();
    const requested = plan();
    const before = structuredClone({ source, manifest, requested });
    const result = composeScene(source, manifest, requested);
    expect({ source, manifest, requested }).toEqual(before);
    expect(result).toMatchObject({
      width: 1000,
      height: 1000,
      canvasId: 'canvas3',
      schemeId: 'custom-scheme-session',
    });
    expect(result.items.map((item) => item.assetId)).toEqual([
      'lamp',
      'book',
      'phone',
    ]);
    expect(result.items.map((item) => item.role)).toEqual([
      'bg',
      'main',
      'main',
    ]);
    for (const item of result.items) {
      expect(item).toMatchObject({ scale: 0.35, size: 'L', rotation: 0 });
      expect(item.colorOverrides).toBeUndefined();
      expect(item.id).not.toBe('composition-1');
    }
    expectReadable(result, manifest);
  });

  it.each([0, 1, 2, 3, 7, 999])(
    'keeps every fixed-size object readable for variant %s',
    (seed) => {
      const requested: CompositionPlan = {
        ...plan(),
        items: [
          ...plan().items,
          { assetId: 'vase', role: 'bg' },
          { assetId: 'folder', role: 'main' },
          { assetId: 'pen', role: 'main' },
        ],
      };
      const result = composeScene(createScene(), library(), requested, seed);
      expect(result.items).toHaveLength(6);
      expectReadable(result, library());
      expect(result.items.every((item) => item.scale === 0.35)).toBe(true);
      expect(result.items.slice(0, 2).every((item) => item.role === 'bg')).toBe(
        true,
      );
    },
  );

  it('honors mixed L/S geometry and original contours at the canonical uniform scale', () => {
    const manifest = library();
    const requested: CompositionPlan = {
      message: 'Mixed detail',
      items: [
        { assetId: 'book', role: 'main', size: 'S' },
        { assetId: 'phone', role: 'main', size: 'L' },
        { assetId: 'lamp', role: 'bg', size: 'S' },
      ],
    };
    const before = structuredClone({ manifest, requested });
    const result = composeScene(createScene(), manifest, requested);
    expect({ manifest, requested }).toEqual(before);
    expect(
      result.items.map(({ assetId, role, size, scale }) => ({
        assetId,
        role,
        size,
        scale,
      })),
    ).toEqual([
      { assetId: 'lamp', role: 'bg', size: 'S', scale: 0.35 },
      { assetId: 'book', role: 'main', size: 'S', scale: 0.35 },
      { assetId: 'phone', role: 'main', size: 'L', scale: 0.35 },
    ]);
    const book = result.items.find(({ assetId }) => assetId === 'book')!;
    const geometry = getObjectGeometry(book, manifest);
    const suppliedSmall = manifest.assets.find(
      ({ id, size }) => id === 'book' && size === 'S',
    )!;
    const suppliedLarge = manifest.assets.find(
      ({ id, size }) => id === 'book' && size === 'L',
    )!;
    expect(geometry.asset).toBe(suppliedSmall);
    expect(geometry.viewBox).toEqual([37, -11, 723, 430]);
    expect(geometry.asset.svg).toBe(suppliedSmall.svg);
    expect(geometry.asset.svg).not.toBe(suppliedLarge.svg);
    expect(geometry.width).toBeCloseTo(506.1);
    expect(geometry.height).toBeCloseTo(301);
    expect(geometry.scale).toBeCloseTo(0.7);
    expect(geometry.width / 723).toBeCloseTo(geometry.height / 430);
    expectReadable(result, manifest);
  });

  it.each([
    {
      name: 'more than two background objects',
      roles: ['bg', 'bg', 'bg', 'main'] as const,
    },
    {
      name: 'only background objects',
      roles: ['bg', 'bg', 'bg', 'bg'] as const,
    },
    {
      name: 'no background objects',
      roles: ['main', 'main', 'main', 'main'] as const,
    },
  ])(
    'accepts $name and keeps background objects below the main ones',
    ({ roles }) => {
      const ids = ['book', 'phone', 'lamp', 'vase'] as const;
      const requested: CompositionPlan = {
        message: 'Roles are selected independently',
        items: roles.map((role, index) => ({
          assetId: ids[index],
          role,
          size: index === 0 || index === 2 ? 'S' : 'L',
        })),
      };
      const result = composeScene(createScene(), library(), requested);
      expect(result.items.map(({ role }) => role)).toEqual([
        ...roles.filter((role) => role === 'bg'),
        ...roles.filter((role) => role === 'main'),
      ]);
      expect(new Set(result.items.map(({ assetId }) => assetId)).size).toBe(4);
      expectReadable(result, library());
    },
  );

  it('rejects unavailable S without replacing an existing scene or inventing geometry', () => {
    const source = {
      ...createScene(),
      items: [createSceneItem('phone', 'keep')],
    };
    const before = structuredClone(source);
    expect(() =>
      composeScene(source, library(), {
        message: 'Unavailable detail',
        items: [{ assetId: 'custom-icon', role: 'bg', size: 'S' }],
      }),
    ).toThrow();
    expect(source).toEqual(before);
  });

  it('is deterministic and offers another arrangement without changing the selected objects', () => {
    const first = composeScene(createScene(), library(), plan(), 0);
    const again = composeScene(createScene(), library(), plan(), 0);
    const another = composeScene(createScene(), library(), plan(), 1);
    expect(again).toEqual(first);
    expect(
      another.items.map((item) => ({
        assetId: item.assetId,
        scale: item.scale,
        role: item.role,
      })),
    ).toEqual(
      first.items.map((item) => ({
        assetId: item.assetId,
        scale: item.scale,
        role: item.role,
      })),
    );
    expect(another.items.map(({ x, y }) => ({ x, y }))).not.toEqual(
      first.items.map(({ x, y }) => ({ x, y })),
    );
  });

  it.each([
    { width: 700, height: 1200 },
    { width: 1400, height: 650 },
  ])(
    'uses rows or columns in a $width × $height format without rescaling',
    ({ width, height }) => {
      const result = composeScene(
        { ...createScene(), width, height },
        library(),
        plan(),
      );
      expectReadable(result, library());
      expect(result.items.every((item) => item.scale === 0.35)).toBe(true);
    },
  );

  it('keeps a single imported artwork at its normal initial size without inventing S', () => {
    const requested: CompositionPlan = {
      message: 'Свой объект',
      items: [{ assetId: 'custom-icon', role: 'main' }],
    };
    const result = composeScene(createScene(), library(), requested);
    const item = result.items[0];
    expect(item).toMatchObject({ x: 500, y: 500, size: 'L', role: 'main' });
    const geometry = getObjectGeometry(item, library());
    expect(geometry.width).toBeCloseTo(250);
    expect(geometry.height).toBeCloseTo(125);
    expectReadable(result, library());
  });

  it('fails with actionable feedback instead of dropping or shrinking objects that do not fit', () => {
    const source = {
      ...createScene(),
      width: 300,
      height: 300,
      items: [createSceneItem('pen', 'keep')],
    };
    const before = structuredClone(source);
    expect(() => composeScene(source, library(), plan())).toThrow(
      /исходных размерах.*формат.*меньше объектов/,
    );
    expect(source).toEqual(before);
  });

  it('rejects empty plans, missing objects, ambiguous geometry, and malformed plans', () => {
    expect(() =>
      composeScene(createScene(), library(), {
        message: 'Нет подходящих объектов.',
        items: [],
      }),
    ).toThrow(/Нет подходящих/);
    expect(() =>
      composeScene(createScene(), { version: 1, assets: [] }, plan()),
    ).toThrow();
    const duplicate = library();
    duplicate.assets.push({ ...duplicate.assets[0] });
    expect(() => composeScene(createScene(), duplicate, plan())).toThrow();
    const withoutL = library();
    withoutL.assets[0].size = 'S';
    expect(() => composeScene(createScene(), withoutL, plan())).toThrow();
    expect(() =>
      composeScene(createScene(), library(), {
        ...plan(),
        items: [{ assetId: 'book', role: 'bad' }],
      } as unknown as CompositionPlan),
    ).toThrow();
    expect(() =>
      composeScene(createScene(), library(), {
        ...plan(),
        items: plan().items.map((item) => ({ ...item, scale: 0.1 })),
      } as CompositionPlan),
    ).toThrow();
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid variant %s', (seed) => {
    expect(() => composeScene(createScene(), library(), plan(), seed)).toThrow(
      /Номер варианта/,
    );
  });
});
