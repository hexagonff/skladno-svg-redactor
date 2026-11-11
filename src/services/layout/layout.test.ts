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
      { ...asset('phone', 399, 231), size: 'S' },
      asset('lamp', 946, 1129),
      asset('vase', 591, 748),
      { ...asset('vase', 324, 409), size: 'S' },
      asset('folder', 1241, 659),
      { ...asset('folder', 621, 330), size: 'S' },
      asset('pen', 509, 286),
      { ...asset('pen', 255, 143), size: 'S' },
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
function expectVisible(result: Scene, manifest: LibraryManifest): void {
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
    expect(Math.min(result.width, box.right)).toBeGreaterThan(
      Math.max(0, box.left),
    );
    expect(Math.min(result.height, box.bottom)).toBeGreaterThan(
      Math.max(0, box.top),
    );
  }
}

describe('fixed-size composition layout', () => {
  it('preserves selected L even when S is available and L extends beyond the canvas', () => {
    const manifest = library();
    const result = composeScene(createScene(), manifest, {
      message: 'Native book',
      items: [{ assetId: 'book', role: 'main', size: 'L' }],
    });
    const book = result.items[0];
    expect(book.size).toBe('L');
    expect(book.scale).toBe(1);
    expect(getObjectGeometry(book, manifest)).toMatchObject({
      width: 1446,
      height: 977,
      scale: 1,
    });
    expect(book.x - 1446 / 2).toBeLessThan(0);
    expect(book.x + 1446 / 2).toBeGreaterThan(result.width);
    expectVisible(result, manifest);
  });

  it('permits partial overlap while preserving all selected objects and their exact source sizes', () => {
    const manifest = library();
    const result = composeScene(createScene(), manifest, {
      ...plan(),
      items: plan().items.map((item) => ({ ...item, size: 'S' })),
    });
    expectVisible(result, manifest);
    expect(result.items).toHaveLength(3);
    for (const item of result.items) {
      const source = manifest.assets.find(
        (asset) => asset.id === item.assetId && asset.size === item.size,
      )!;
      expect(getObjectGeometry(item, manifest)).toMatchObject({
        width: source.width,
        height: source.height,
        scale: 1,
      });
    }
    const boxes = result.items.map((item) => ({
      item,
      geometry: getObjectGeometry(item, manifest),
    }));
    expect(
      boxes.some((a, index) =>
        boxes
          .slice(index + 1)
          .some(
            (b) =>
              Math.abs(a.item.x - b.item.x) <
                (a.geometry.width + b.geometry.width) / 2 &&
              Math.abs(a.item.y - b.item.y) <
                (a.geometry.height + b.geometry.height) / 2,
          ),
      ),
    ).toBe(true);
  });

  it('keeps enough-space compositions separate at native size', () => {
    const manifest = library();
    const result = composeScene(createScene(), manifest, {
      message: 'Two small sources',
      items: [
        { assetId: 'pen', role: 'main', size: 'S' },
        { assetId: 'custom-icon', role: 'bg', size: 'L' },
      ],
    });
    const [a, b] = result.items;
    const ga = getObjectGeometry(a, manifest),
      gb = getObjectGeometry(b, manifest);
    expect(
      Math.abs(a.x - b.x) >= (ga.width + gb.width) / 2 ||
        Math.abs(a.y - b.y) >= (ga.height + gb.height) / 2,
    ).toBe(true);
    expect(result.items.every((item) => item.scale === 1)).toBe(true);
  });

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
      expect(item).toMatchObject({ scale: 1, rotation: 0 });
      expect(item.colorOverrides).toBeUndefined();
      expect(item.id).not.toBe('composition-1');
    }
    expectVisible(result, manifest);
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
      expectVisible(result, library());
      expect(result.items.every((item) => item.scale === 1)).toBe(true);
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
      { assetId: 'lamp', role: 'bg', size: 'S', scale: 1 },
      { assetId: 'phone', role: 'main', size: 'L', scale: 1 },
      { assetId: 'book', role: 'main', size: 'S', scale: 1 },
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
    expect(geometry.width).toBeCloseTo(723);
    expect(geometry.height).toBeCloseTo(430);
    expect(geometry.scale).toBe(1);
    expect(geometry.width / 723).toBeCloseTo(geometry.height / 430);
    expectVisible(result, manifest);
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
      expectVisible(result, library());
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
    { width: 800, height: 1200 },
    { width: 1400, height: 650 },
  ])(
    'preserves selected sources in a $width × $height format without rescaling',
    ({ width, height }) => {
      const result = composeScene(
        { ...createScene(), width, height },
        library(),
        plan(),
      );
      expectVisible(result, library());
      expect(result.items.every((item) => item.scale === 1)).toBe(true);
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
    expect(geometry.width).toBeCloseTo(24);
    expect(geometry.height).toBeCloseTo(12);
    expectVisible(result, library());
  });

  it('keeps all oversized sources on a small canvas without changing the original scene', () => {
    const source = {
      ...createScene(),
      width: 300,
      height: 300,
      items: [createSceneItem('pen', 'keep')],
    };
    const before = structuredClone(source);
    const result = composeScene(source, library(), plan());
    expect(source).toEqual(before);
    expect(result.items).toHaveLength(3);
    expect(
      result.items.every((item) => item.size === 'L' && item.scale === 1),
    ).toBe(true);
    expectVisible(result, library());
  });

  it.each(['main', 'bg'] as const)(
    'places smaller %s sources above a source covering the entire canvas',
    (role) => {
      const manifest: LibraryManifest = {
        version: 1,
        assets: [
          asset('custom-large', 2400, 1800),
          asset('custom-small', 100, 80),
        ],
      };
      const result = composeScene(
        { ...createScene(), width: 500, height: 500, canvasSize: 'S' },
        manifest,
        {
          message: 'Large source with a small accent',
          items: [
            { assetId: 'custom-small', role },
            { assetId: 'custom-large', role },
          ],
        },
      );
      expect(result.items.map((item) => item.assetId)).toEqual([
        'custom-large',
        'custom-small',
      ]);
      const [large, small] = result.items;
      expect(large).toMatchObject({ size: 'L', scale: 1 });
      expect(small).toMatchObject({ size: 'L', scale: 1 });
      expect(small.x - 50).toBeGreaterThanOrEqual(0);
      expect(small.y - 40).toBeGreaterThanOrEqual(0);
      expect(small.x + 50).toBeLessThanOrEqual(500);
      expect(small.y + 40).toBeLessThanOrEqual(500);
      expect(
        Math.abs(large.x - small.x) < (2400 + 100) / 2 &&
          Math.abs(large.y - small.y) < (1800 + 80) / 2,
      ).toBe(true);
      expect(large.x).toBeGreaterThanOrEqual(0);
      expect(large.x).toBeLessThanOrEqual(500);
      expect(large.y).toBeGreaterThanOrEqual(0);
      expect(large.y).toBeLessThanOrEqual(500);
      expectVisible(result, manifest);
    },
  );

  it('uses free canvas space around an oversized source when an accent can fit there', () => {
    const manifest: LibraryManifest = {
      version: 1,
      assets: [asset('custom-wide', 1200, 220), asset('custom-small', 100, 80)],
    };
    const result = composeScene(createScene(), manifest, {
      message: 'Wide source with a small accent',
      items: [
        { assetId: 'custom-small', role: 'main' },
        { assetId: 'custom-wide', role: 'main' },
      ],
    });
    const [wide, small] = result.items;
    expect(wide.assetId).toBe('custom-wide');
    expect(wide.size).toBe('L');
    expect(wide.scale).toBe(1);
    expect(Math.abs(wide.y - small.y)).toBeGreaterThanOrEqual((220 + 80) / 2);
    expectVisible(result, manifest);
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
