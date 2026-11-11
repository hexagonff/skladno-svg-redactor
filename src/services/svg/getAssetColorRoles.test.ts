import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { LibraryAsset, LibraryManifest } from '../../domain/library';
import { getAssetColorRoles } from './getAssetColorRoles';

const manifest = JSON.parse(
  readFileSync(
    new URL('../../assets/library/manifest.json', import.meta.url),
    'utf8',
  ),
) as LibraryManifest;

const fixture: LibraryAsset = {
  id: 'book',
  size: 'L',
  kind: 'object',
  sourceScheme: 'purple',
  width: 10,
  height: 10,
  viewBox: '0 0 10 10',
  svg: `<svg fill="var(--obj3)">
    <defs><path fill="var(--bg3)"/></defs>
    <clipPath id="clip"><path stroke="var(--bg2)"/></clipPath>
    <g stroke="var(--bg1)">
      <path fill="var(--black)" stroke="var(--white)"/>
      <path style="fill: var(--obj1); stroke: var(--bg1) !important"/>
      <path fill="none"/>
    </g>
  </svg>`,
  backgroundSvg: '<svg><path fill="var(--bg3)" stroke="var(--bg1)"/></svg>',
};

describe('getAssetColorRoles', () => {
  it.each(['L', 'S'] as const)(
    'finds the wallet body and accent roles in the real %s artwork',
    (size) => {
      const wallet = manifest.assets.find(
        (asset) => asset.id === 'wallet' && asset.size === size,
      )!;
      expect(getAssetColorRoles(wallet)).toEqual(['bg1', 'obj1']);
      expect(getAssetColorRoles(wallet, 'bg')).toEqual(['bg1', 'bg3']);
    },
  );

  it('reads inherited paints and inline styles, excludes neutrals and definitions, and uses a stable order', () => {
    const original = fixture.svg;
    expect(getAssetColorRoles(fixture)).toEqual(['bg1', 'obj1', 'obj3']);
    expect(fixture.svg).toBe(original);
    expect(getAssetColorRoles(fixture, 'bg')).toEqual(['bg1', 'bg3']);
  });

  it('reads each size independently instead of deriving roles from the L asset', () => {
    const small = {
      ...fixture,
      size: 'S' as const,
      svg: '<svg><path fill="var(--obj2)"/></svg>',
    };
    expect(getAssetColorRoles(small)).toEqual(['obj2']);
    expect(getAssetColorRoles(fixture)).not.toContain('obj2');
  });

  it('reports a missing background variant instead of silently using the main artwork', () => {
    expect(() =>
      getAssetColorRoles({ ...fixture, backgroundSvg: undefined }, 'bg'),
    ).toThrow(/Missing background variant/);
  });
});
