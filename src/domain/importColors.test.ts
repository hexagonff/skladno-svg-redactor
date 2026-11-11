import { describe, expect, it } from 'vitest';
import builtInSchemes from '../assets/schemes.json';
import { COLOR_ROLES, type ColorRole } from './colors';
import { assignImportedColorRoles } from './importColors';
import { EDITABLE_COLOR_ROLES } from './objectColors';

const palette: Readonly<Record<ColorRole, string>> = Object.freeze({
  bg1: '#D7CDF5',
  bg2: '#AA9BF0',
  bg3: '#7864D7',
  black: '#181817',
  obj1: '#F9ECB0',
  obj2: '#F9A3AA',
  obj3: '#FFE3E1',
  white: '#FFFFFF',
});

describe('automatic imported color roles', () => {
  it.each(builtInSchemes)(
    'preserves all exact roles in the $id source scheme',
    (scheme) => {
      const result = assignImportedColorRoles(
        Object.values(scheme.colors),
        scheme.colors,
      );
      expect(result.mergedColorCount).toBe(0);
      for (const role of COLOR_ROLES)
        expect(result.colorMap[scheme.colors[role]]).toBe(role);
    },
  );

  it('uses the active source scheme rather than a global reverse color table', () => {
    const orange = builtInSchemes.find((scheme) => scheme.id === 'orange')!;
    const teal = builtInSchemes.find((scheme) => scheme.id === 'teal')!;
    expect(
      assignImportedColorRoles(['#80DADA', '#BEEBEB'], orange.colors).colorMap,
    ).toEqual({
      '#80DADA': 'obj2',
      '#BEEBEB': 'obj3',
    });
    expect(
      assignImportedColorRoles(['#80DADA', '#BEEBEB'], teal.colors).colorMap,
    ).toEqual({
      '#80DADA': 'bg2',
      '#BEEBEB': 'bg1',
    });
  });

  it('deduplicates identical normalized colors and recognizes neutral aliases', () => {
    const result = assignImportedColorRoles(
      [' #d7cdf5 ', '#D7CDF5', '#000000', '#181817', '#ffffff', '#FFFFFF'],
      palette,
    );
    expect(result).toEqual({
      colorMap: {
        '#D7CDF5': 'bg1',
        '#000000': 'black',
        '#181817': 'black',
        '#FFFFFF': 'white',
      },
      mergedColorCount: 0,
    });
  });

  it('retains separate source shades instead of greedily merging similar colors', () => {
    const result = assignImportedColorRoles(
      ['#D7CDF4', '#D7CDF3', '#D7CDF2'],
      palette,
    );
    expect(new Set(Object.values(result.colorMap)).size).toBe(3);
    expect(
      Object.values(result.colorMap).every((role) =>
        EDITABLE_COLOR_ROLES.includes(
          role as (typeof EDITABLE_COLOR_ROLES)[number],
        ),
      ),
    ).toBe(true);
    expect(result.mergedColorCount).toBe(0);
  });

  it('reserves exact roles before assigning unknown colors, regardless of input order', () => {
    const result = assignImportedColorRoles(['#D7CDF4', '#D7CDF5'], palette);
    expect(result.colorMap['#D7CDF5']).toBe('bg1');
    expect(result.colorMap['#D7CDF4']).not.toBe('bg1');
    expect(result.mergedColorCount).toBe(0);
  });

  it('finds the globally closest distinct assignments rather than a greedy match', () => {
    const simplePalette = { ...palette, bg1: '#00000A', bg2: '#000014' };
    const result = assignImportedColorRoles(
      [
        simplePalette.bg3,
        simplePalette.obj1,
        simplePalette.obj2,
        simplePalette.obj3,
        '#000010',
        '#000012',
      ],
      simplePalette,
    );
    // Greedy would assign the first blue to bg2, leaving bg1 for the second.
    expect(result.colorMap['#000010']).toBe('bg1');
    expect(result.colorMap['#000012']).toBe('bg2');
  });

  it('is independent of input ordering, repetition and casing even for tied matches', () => {
    const tiedPalette = { ...palette, bg1: '#00000A', bg2: '#000014' };
    const colors = [
      '#00000F',
      '#000010',
      '#AA3344',
      '#669988',
      '#3344AA',
      '#AABBCD',
      '#F0DDEE',
    ];
    const expected = assignImportedColorRoles(colors, tiedPalette);
    expect(
      assignImportedColorRoles([...colors].reverse(), tiedPalette),
    ).toEqual(expected);
    expect(
      assignImportedColorRoles(
        [...colors.slice(2), ...colors.slice(0, 2), ...colors].map((color) =>
          color.toLowerCase(),
        ),
        tiedPalette,
      ),
    ).toEqual(expected);
  });

  it('merges only the extra unique source colors after all six editable roles are used', () => {
    const colors = [
      '#CC1122',
      '#CC1123',
      '#CC1124',
      '#CC1125',
      '#CC1126',
      '#CC1127',
      '#CC1128',
      '#CC1129',
    ];
    const result = assignImportedColorRoles([...colors, ...colors], palette);
    expect(result.mergedColorCount).toBe(2);
    expect(Object.keys(result.colorMap)).toHaveLength(colors.length);
    expect(new Set(Object.values(result.colorMap)).size).toBe(6);
    expect(
      Object.values(result.colorMap).every(
        (role) => role !== 'black' && role !== 'white',
      ),
    ).toBe(true);
  });

  it('maps overflow to the closest editable color when exact colors reserve every slot', () => {
    const result = assignImportedColorRoles(
      [...Object.values(palette), '#D7CDF4', '#D7CDF3', '#000000', '#D7CDF4'],
      palette,
    );
    expect(result.colorMap['#D7CDF4']).toBe('bg1');
    expect(result.colorMap['#D7CDF3']).toBe('bg1');
    expect(result.mergedColorCount).toBe(2);
  });

  it('supports the importer maximum of 64 unique source colors deterministically', () => {
    const colors = Array.from(
      { length: 64 },
      (_, index) => `#ABCD${index.toString(16).padStart(2, '0')}`,
    );
    const result = assignImportedColorRoles(colors, palette);
    expect(result.mergedColorCount).toBe(58);
    expect(Object.keys(result.colorMap)).toHaveLength(64);
    expect(new Set(Object.values(result.colorMap)).size).toBe(6);
    expect(assignImportedColorRoles(colors.reverse(), palette)).toEqual(result);
  });

  it('accepts an empty color list without inventing entries', () => {
    expect(assignImportedColorRoles([], palette)).toEqual({
      colorMap: {},
      mergedColorCount: 0,
    });
  });

  it('normalizes palette hex values without mutating inputs', () => {
    const colors = Object.freeze(['#d7cdf5', '#ffffff']);
    const sourcePalette = Object.freeze(
      Object.fromEntries(
        Object.entries(palette).map(([role, color]) => [
          role,
          color.toLowerCase(),
        ]),
      ) as Record<ColorRole, string>,
    );
    expect(assignImportedColorRoles(colors, sourcePalette).colorMap).toEqual({
      '#D7CDF5': 'bg1',
      '#FFFFFF': 'white',
    });
    expect(colors[0]).toBe('#d7cdf5');
    expect(sourcePalette.bg1).toBe('#d7cdf5');
  });

  it.each([
    '#123',
    '#12345678',
    'red',
    'rgb(1, 2, 3)',
    '#GGGGGG',
    '',
    null,
    NaN,
    Infinity,
  ])('rejects invalid or unnormalized source color %j', (color) => {
    expect(() => assignImportedColorRoles([color as string], palette)).toThrow(
      /#RRGGBB/,
    );
  });

  it.each(['#123', 'invalid', '', undefined, NaN, Infinity])(
    'rejects invalid or missing palette color %j before assigning',
    (color) => {
      expect(() =>
        assignImportedColorRoles(['#ABCDEF'], {
          ...palette,
          bg1: color as string,
        }),
      ).toThrow(/#RRGGBB/);
    },
  );

  it('rejects malformed containers without creating invalid role entries', () => {
    expect(() =>
      assignImportedColorRoles(null as unknown as string[], palette),
    ).toThrow(/array/);
    expect(() =>
      assignImportedColorRoles([], null as unknown as typeof palette),
    ).toThrow(/source palette/);
    expect(() =>
      assignImportedColorRoles([], [] as unknown as typeof palette),
    ).toThrow(/source palette/);
  });
});
