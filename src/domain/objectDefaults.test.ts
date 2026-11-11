import { describe, expect, it } from 'vitest';
import type { LibraryAsset, LibraryManifest } from './library';
import { getDefaultObjectScale } from './objectDefaults';
import { getObjectGeometry } from './objectGeometry';
import { createSceneItem, type ObjectId } from './scene';

function library(id: ObjectId, width: number, height: number): LibraryManifest {
  const asset: LibraryAsset = {
    id,
    size: 'L',
    kind: 'object',
    sourceScheme: 'purple',
    width,
    height,
    viewBox: `-12 5 ${width} ${height}`,
    svg: '<svg/>',
  };
  return { version: 1, assets: [asset] };
}

describe('default object sizes', () => {
  it('preserves the established built-in scale and the original relative sizes', () => {
    expect(getDefaultObjectScale('book', library('book', 1446, 977))).toBe(
      0.35,
    );
    expect(getDefaultObjectScale('lamp', library('lamp', 946, 1129))).toBe(
      0.35,
    );
  });

  it.each([
    [24, 12],
    [10, 1000],
    [12000, 6000],
  ])(
    'fits an imported %s × %s source to the same initial 250-unit longer side',
    (width, height) => {
      const manifest = library('custom-icon', width, height);
      const before = structuredClone(manifest);
      const scale = getDefaultObjectScale('custom-icon', manifest);
      const item = { ...createSceneItem('custom-icon', 'imported'), scale };
      const geometry = getObjectGeometry(item, manifest);
      expect(Math.max(geometry.width, geometry.height)).toBeCloseTo(250);
      expect(geometry.width / geometry.height).toBeCloseTo(width / height);
      expect(manifest).toEqual(before);
    },
  );

  it('requires unique, valid registered source geometry for either kind of object', () => {
    expect(() =>
      getDefaultObjectScale('book', { version: 1, assets: [] }),
    ).toThrow(/object asset/);
    const manifest = library('custom-icon', 24, 12);
    manifest.assets.push({ ...manifest.assets[0] });
    expect(() => getDefaultObjectScale('custom-icon', manifest)).toThrow(
      /object asset/,
    );
    expect(() =>
      getDefaultObjectScale('canvas1' as ObjectId, library('book', 10, 10)),
    ).toThrow(/Unknown object/);
  });
});
