import type { ColorMap, ColorRole } from './colors';

export const ASSET_IDS = [
  'vase',
  'book',
  'wallet',
  'lamp',
  'coin',
  'headphones',
  'puzzle',
  'folder',
  'pen',
  'phone',
  'canvas1',
  'canvas2',
  'canvas3',
] as const;
export const ASSET_SIZES = ['L', 'S'] as const;
export const CANVAS_IDS = ['canvas1', 'canvas2', 'canvas3'] as const;
export const SCHEME_IDS = ['purple', 'orange', 'teal'] as const;

export type BuiltinAssetId = (typeof ASSET_IDS)[number];
export type ImportedAssetId = `custom-${string}`;
export type AssetId = BuiltinAssetId | ImportedAssetId;

/** Session imports use a reserved namespace; catalog membership is checked separately. */
export function isImportedAssetId(value: unknown): value is ImportedAssetId {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^custom-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)
  );
}
export type AssetSize = (typeof ASSET_SIZES)[number];
export type BuiltinSchemeId = (typeof SCHEME_IDS)[number];
export type CustomSchemeId = `custom-scheme-${string}`;
export type SchemeId = BuiltinSchemeId | CustomSchemeId;

/** Session palettes use a reserved namespace; registration is checked separately. */
export function isCustomSchemeId(value: unknown): value is CustomSchemeId {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^custom-scheme-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)
  );
}
export type CanvasId = (typeof CANVAS_IDS)[number];

// These describe source artwork, independently of the selected output scheme.
export const SOURCE_SCHEMES: Readonly<Record<BuiltinAssetId, BuiltinSchemeId>> =
  {
    vase: 'purple',
    book: 'purple',
    wallet: 'purple',
    lamp: 'purple',
    coin: 'purple',
    headphones: 'purple',
    puzzle: 'purple',
    folder: 'purple',
    pen: 'purple',
    phone: 'purple',
    canvas1: 'purple',
    canvas2: 'orange',
    canvas3: 'teal',
  };

export interface ColorScheme {
  id: SchemeId;
  name: string;
  // Source-artwork metadata; the scene selects its canvas independently.
  canvas?: CanvasId;
  colors: Record<ColorRole, string>;
}

export type SchemeColorMaps = Readonly<Record<BuiltinSchemeId, ColorMap>>;
export interface AssetTags {
  tags: string[];
  synonyms: { ru: string[]; en: string[] };
}
export type LibraryTags = Readonly<Record<BuiltinAssetId, AssetTags>>;

export interface AssetSource {
  filename: string;
  svg: string;
}

export interface LibraryAsset {
  id: AssetId;
  size: AssetSize;
  kind: 'object' | 'canvas';
  sourceScheme: SchemeId;
  width: number;
  height: number;
  viewBox: string;
  svg: string;
  backgroundSvg?: string;
}

export interface LibraryManifest {
  version: 1;
  assets: LibraryAsset[];
}
