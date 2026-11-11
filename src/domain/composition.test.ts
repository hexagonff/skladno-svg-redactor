import { describe, expect, it } from 'vitest';
import { OBJECT_CATALOG, type CatalogObject } from './catalog';
import {
  COMPOSITION_MAX_ITEMS,
  createCompositionCatalog,
  validateCompositionPlan,
  validateCompositionRequest,
} from './composition';
import type {
  AssetId,
  AssetSize,
  LibraryAsset,
  LibraryManifest,
} from './library';

const builtinEntry = {
  id: 'book',
  name: 'User book',
  description: 'A book for studying.',
};
const customEntry = {
  id: 'custom-one',
  name: 'Imported shape',
  description: 'A registered imported shape.',
};

function request(catalog: unknown[] = [builtinEntry]) {
  return { prompt: 'Study', catalog };
}

function plan(items: unknown[]) {
  return { items, message: 'Composition' };
}

function asset(
  id: AssetId,
  size: AssetSize,
  kind: LibraryAsset['kind'] = 'object',
): LibraryAsset {
  return {
    id,
    size,
    kind,
    sourceScheme: 'purple',
    width: 40,
    height: 20,
    viewBox: '0 0 40 20',
    svg: '<svg/>',
  };
}

describe('composition catalog detail metadata', () => {
  it('uses canonical names and descriptions, with builtin L/S and imported L when no manifest is given', () => {
    const input = [
      {
        ...builtinEntry,
        name: 'Forged book',
        description: 'Forged instructions',
        availableSizes: ['S'],
      },
      { ...customEntry, availableSizes: ['L', 'S'] },
    ] as unknown as CatalogObject[];
    const entries = createCompositionCatalog(input);
    expect(entries[0]).toMatchObject({
      id: 'book',
      name: OBJECT_CATALOG.find(({ id }) => id === 'book')!.name,
      availableSizes: ['L', 'S'],
    });
    expect(entries[0].description).not.toContain('Forged');
    expect(entries[1]).toMatchObject({
      id: 'custom-one',
      name: customEntry.name,
      availableSizes: ['L'],
    });
    expect(entries[1].description).toContain(customEntry.name);
    expect(entries[1].description).not.toBe(customEntry.description);
    expect(input[0].name).toBe('Forged book');
  });

  it('reads actual object variants from the manifest in L/S order and ignores canvas variants and duplicates', () => {
    const manifest: LibraryManifest = {
      version: 1,
      assets: [
        asset('book', 'S'),
        asset('book', 'L'),
        asset('book', 'S'),
        asset('phone', 'L', 'canvas'),
        asset('phone', 'S'),
        asset('custom-one', 'L'),
        asset('custom-one', 'S', 'canvas'),
      ],
    };
    const before = structuredClone(manifest);
    const entries = createCompositionCatalog(
      [
        { id: 'book', name: 'Book' },
        { id: 'phone', name: 'Phone' },
        { id: 'custom-one', name: 'Imported shape' },
      ],
      manifest,
    );
    expect(entries.map(({ availableSizes }) => availableSizes)).toEqual([
      ['L', 'S'],
      ['S'],
      ['L'],
    ]);
    expect(manifest).toEqual(before);
  });

  it('does not advertise a variant absent from the actual manifest', () => {
    const entries = createCompositionCatalog([{ id: 'book', name: 'Book' }], {
      version: 1,
      assets: [],
    });
    expect(entries[0].availableSizes).toEqual([]);
    expect(() => validateCompositionRequest(request(entries))).toThrow();
  });

  it('rebuilds claimed imported S metadata and descriptions without trusting the request', () => {
    const parsed = validateCompositionRequest(
      request([{ ...customEntry, availableSizes: ['S'] }]),
    );
    const canonical = createCompositionCatalog(parsed.catalog);
    expect(canonical[0].availableSizes).toEqual(['L']);
    expect(canonical[0].description).not.toBe(customEntry.description);
    expect(() =>
      validateCompositionPlan(
        plan([{ assetId: 'custom-one', role: 'main', size: 'S' }]),
        canonical,
      ),
    ).toThrow();
  });
});

describe('composition request detail validation', () => {
  it('normalizes legacy entries to builtin L/S and imported L without mutating the input', () => {
    const input = request([builtinEntry, customEntry]);
    const before = structuredClone(input);
    const parsed = validateCompositionRequest(input);
    expect(parsed.catalog.map(({ availableSizes }) => availableSizes)).toEqual([
      ['L', 'S'],
      ['L'],
    ]);
    expect(input).toEqual(before);
  });

  it('accepts unique nonempty declared variants and returns them in canonical order', () => {
    const parsed = validateCompositionRequest(
      request([
        { ...builtinEntry, availableSizes: ['S', 'L'] },
        { ...customEntry, availableSizes: ['L'] },
      ]),
    );
    expect(parsed.catalog.map(({ availableSizes }) => availableSizes)).toEqual([
      ['L', 'S'],
      ['L'],
    ]);
    const smallOnly = validateCompositionRequest(
      request([{ ...builtinEntry, availableSizes: ['S'] }]),
    );
    expect(smallOnly.catalog[0].availableSizes).toEqual(['S']);
  });

  it.each([[], ['M'], ['L', 'L'], ['S', 'S'], ['L', 'S', 'L'], null, 'L'])(
    'rejects invalid declared variants %j',
    (availableSizes) => {
      expect(() =>
        validateCompositionRequest(
          request([{ ...builtinEntry, availableSizes }]),
        ),
      ).toThrow();
    },
  );

  it('still rejects duplicate IDs, unknown IDs, and empty catalogs', () => {
    expect(() =>
      validateCompositionRequest(request([builtinEntry, builtinEntry])),
    ).toThrow();
    expect(() =>
      validateCompositionRequest(request([{ ...builtinEntry, id: 'unknown' }])),
    ).toThrow();
    expect(() => validateCompositionRequest(request([]))).toThrow();
  });

  it.each(['x', 'svg', 'fill', 'colorOverrides'])(
    'rejects user-supplied %s outside catalog metadata',
    (field) => {
      expect(() =>
        validateCompositionRequest(request([{ ...builtinEntry, [field]: 1 }])),
      ).toThrow();
    },
  );
});

describe('composition plan detail and role validation', () => {
  const catalog = [
    { id: 'book', availableSizes: ['L', 'S'] as const },
    { id: 'phone', availableSizes: ['L', 'S'] as const },
    { id: 'custom-one', availableSizes: ['L'] as const },
  ];

  it('accepts mixed L/S detail independently of main/bg roles and preserves input order', () => {
    const input = plan([
      { assetId: 'book', role: 'bg', size: 'S' },
      { assetId: 'phone', role: 'main', size: 'L' },
      { assetId: 'custom-one', role: 'bg', size: 'L' },
    ]);
    expect(validateCompositionPlan(input, catalog)).toEqual(input);
  });

  it('defaults old plans without size to L for builtins and imported objects', () => {
    const parsed = validateCompositionPlan(
      plan([
        { assetId: 'book', role: 'main' },
        { assetId: 'custom-one', role: 'bg' },
      ]),
      [{ id: 'book' }, { id: 'custom-one' }],
    );
    expect(parsed.items).toEqual([
      { assetId: 'book', role: 'main', size: 'L' },
      { assetId: 'custom-one', role: 'bg', size: 'L' },
    ]);
  });

  it('allows builtin S through legacy metadata fallback and rejects imported S', () => {
    expect(
      validateCompositionPlan(
        plan([{ assetId: 'book', role: 'main', size: 'S' }]),
        [{ id: 'book' }],
      ).items[0].size,
    ).toBe('S');
    expect(() =>
      validateCompositionPlan(
        plan([{ assetId: 'custom-one', role: 'main', size: 'S' }]),
        [{ id: 'custom-one' }],
      ),
    ).toThrow();
  });

  it('accepts imported S only when actual catalog metadata explicitly registers it', () => {
    const entries = createCompositionCatalog(
      [{ id: 'custom-one', name: 'Imported shape' }],
      {
        version: 1,
        assets: [asset('custom-one', 'L'), asset('custom-one', 'S')],
      },
    );
    expect(
      validateCompositionPlan(
        plan([{ assetId: 'custom-one', role: 'bg', size: 'S' }]),
        entries,
      ).items[0].size,
    ).toBe('S');
  });

  it('rejects unavailable builtin variants and a default L when only S exists', () => {
    expect(() =>
      validateCompositionPlan(
        plan([{ assetId: 'book', role: 'main', size: 'S' }]),
        [{ id: 'book', availableSizes: ['L'] }],
      ),
    ).toThrow();
    expect(() =>
      validateCompositionPlan(plan([{ assetId: 'book', role: 'main' }]), [
        { id: 'book', availableSizes: ['S'] },
      ]),
    ).toThrow();
  });

  it.each(['M', '', null, 1, [], {}])(
    'rejects an explicitly invalid detail %j instead of replacing it with L',
    (size) => {
      expect(() =>
        validateCompositionPlan(
          plan([{ assetId: 'book', role: 'main', size }]),
          catalog,
        ),
      ).toThrow();
    },
  );

  it('allows more than two background objects, including an all-background scene', () => {
    const entries = OBJECT_CATALOG.slice(0, COMPOSITION_MAX_ITEMS);
    const input = plan(
      entries.map(({ id }, index) => ({
        assetId: id,
        role: 'bg',
        size: index % 2 === 0 ? 'L' : 'S',
      })),
    );
    const parsed = validateCompositionPlan(input, entries);
    expect(parsed.items).toHaveLength(COMPOSITION_MAX_ITEMS);
    expect(parsed.items.every(({ role }) => role === 'bg')).toBe(true);
  });

  it('allows scenes without background objects and empty results', () => {
    const input = plan([
      { assetId: 'book', role: 'main', size: 'L' },
      { assetId: 'phone', role: 'main', size: 'S' },
    ]);
    expect(validateCompositionPlan(input, catalog)).toEqual(input);
    expect(validateCompositionPlan(plan([]), catalog).items).toEqual([]);
  });

  it('retains the total maximum of six objects', () => {
    const entries = OBJECT_CATALOG.slice(0, COMPOSITION_MAX_ITEMS + 1);
    expect(() =>
      validateCompositionPlan(
        plan(entries.map(({ id }) => ({ assetId: id, role: 'bg', size: 'L' }))),
        entries,
      ),
    ).toThrow();
  });

  it('still rejects duplicate choices, unknown assets, absent catalog IDs, and invalid roles', () => {
    for (const items of [
      [
        { assetId: 'book', role: 'main', size: 'L' },
        { assetId: 'book', role: 'bg', size: 'S' },
      ],
      [{ assetId: 'unknown', role: 'main', size: 'L' }],
      [{ assetId: 'lamp', role: 'main', size: 'L' }],
      [{ assetId: 'book', role: 'unknown', size: 'L' }],
    ]) {
      expect(() => validateCompositionPlan(plan(items), catalog)).toThrow();
    }
  });

  it.each([
    'x',
    'y',
    'width',
    'height',
    'scale',
    'rotation',
    'transform',
    'svg',
    'fill',
    'colors',
    'colorOverrides',
  ])('rejects model-supplied geometry or paint field %s', (field) => {
    expect(() =>
      validateCompositionPlan(
        plan([{ assetId: 'book', role: 'main', size: 'L', [field]: 1 }]),
        catalog,
      ),
    ).toThrow();
  });

  it('rejects unknown top-level plan fields as before', () => {
    expect(() =>
      validateCompositionPlan(
        { ...plan([{ assetId: 'book', role: 'main' }]), svg: '<svg/>' },
        catalog,
      ),
    ).toThrow();
  });
});
