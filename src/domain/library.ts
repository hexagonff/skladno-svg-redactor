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
export const SCHEME_IDS = ['purple', 'orange', 'teal'] as const;

export type AssetId = (typeof ASSET_IDS)[number];
export type AssetSize = (typeof ASSET_SIZES)[number];
export type SchemeId = (typeof SCHEME_IDS)[number];
export type CanvasId = Extract<AssetId, `canvas${number}`>;

// These describe source artwork, independently of the selected output scheme.
export const SOURCE_SCHEMES: Readonly<Record<AssetId, SchemeId>> = {
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
  canvas: CanvasId;
  colors: Record<ColorRole, string>;
}

export type SchemeColorMaps = Readonly<Record<SchemeId, ColorMap>>;
export interface AssetTags {
  tags: string[];
  synonyms: { ru: string[]; en: string[] };
}
export type LibraryTags = Readonly<Record<AssetId, AssetTags>>;

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
