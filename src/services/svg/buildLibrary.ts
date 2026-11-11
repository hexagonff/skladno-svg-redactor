import { COLOR_ROLES, roleToken } from '../../domain/colors';
import {
  ASSET_IDS,
  ASSET_SIZES,
  SCHEME_IDS,
  SOURCE_SCHEMES,
  type AssetSource,
  type ColorScheme,
  type LibraryAsset,
  type LibraryManifest,
  type SchemeColorMaps,
} from '../../domain/library';
import { normalizeColor } from './normalizeColor';
import { prepareSvg } from './prepareSvg';
import { parseSvg } from './svgDocument';
import { toBackgroundVariant } from './toBackgroundVariant';

function validateSchemes(
  schemes: readonly ColorScheme[],
  maps: SchemeColorMaps,
) {
  if (schemes.length !== SCHEME_IDS.length) {
    throw new Error('Expected exactly three color schemes.');
  }
  const assignments = new Map<string, string[]>();
  for (const id of SCHEME_IDS) {
    const matches = schemes.filter((scheme) => scheme.id === id);
    const scheme = matches[0];
    if (matches.length !== 1 || !scheme || !maps[id]) {
      throw new Error(`Missing or duplicate scheme: ${id}`);
    }
    if (
      scheme.canvas === undefined ||
      !scheme.canvas.startsWith('canvas') ||
      SOURCE_SCHEMES[scheme.canvas] !== id
    ) {
      throw new Error(`Incorrect canvas assignment for ${id}.`);
    }
    const entries = Object.entries(maps[id]);
    const normalizedMap = new Map(
      entries.map(([hex, role]) => [normalizeColor(hex), role]),
    );
    if (
      entries.length !== COLOR_ROLES.length ||
      normalizedMap.size !== COLOR_ROLES.length ||
      Object.keys(scheme.colors).length !== COLOR_ROLES.length
    ) {
      throw new Error(`Expected eight distinct role colors for ${id}.`);
    }
    for (const role of COLOR_ROLES) {
      const hex = normalizeColor(scheme.colors[role]);
      if (!hex || normalizedMap.get(hex) !== role) {
        throw new Error(`Color map disagrees with ${id}.${role}.`);
      }
      const values = assignments.get(hex) ?? [];
      values.push(`${id}.${role}`);
      assignments.set(hex, values);
    }
  }
  return [...assignments]
    .filter(
      ([, values]) =>
        new Set(values.map((value) => value.split('.')[1])).size > 1,
    )
    .map(
      ([hex, values]) =>
        `${hex}: ${values.join(', ')}; used separate source-scheme maps.`,
    );
}

function dimension(value: string | null, name: string): number {
  if (!value || !/^\d+(?:\.\d+)?(?:px)?$/.test(value)) {
    throw new Error(`Invalid SVG ${name}: ${value}`);
  }
  const number = Number(value.replace(/px$/, ''));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid SVG ${name}: ${value}`);
  }
  return number;
}

export function buildLibrary(
  sources: readonly AssetSource[],
  schemes: readonly ColorScheme[],
  colorMaps: SchemeColorMaps,
): { manifest: LibraryManifest; warnings: string[] } {
  const warnings = validateSchemes(schemes, colorMaps);
  const expected = new Set<string>(
    ASSET_IDS.flatMap((id) => ASSET_SIZES.map((size) => `${id}__${size}.svg`)),
  );
  const files = new Map<string, string>();
  for (const source of sources) {
    if (!expected.has(source.filename)) {
      throw new Error(`Unexpected asset filename: ${source.filename}`);
    }
    if (files.has(source.filename)) {
      throw new Error(`Duplicate asset: ${source.filename}`);
    }
    files.set(source.filename, source.svg);
  }
  const assets: LibraryAsset[] = [];
  for (const id of ASSET_IDS) {
    for (const size of ASSET_SIZES) {
      const filename = `${id}__${size}.svg`;
      const source = files.get(filename);
      if (source === undefined)
        throw new Error(`Missing independent asset: ${filename}`);
      const root = parseSvg(source).documentElement;
      if (!root) throw new Error(`Missing SVG root: ${filename}`);
      const width = dimension(root.getAttribute('width'), 'width');
      const height = dimension(root.getAttribute('height'), 'height');
      const viewBox = root.getAttribute('viewBox') ?? '';
      const box = viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        box.length !== 4 ||
        !box.every(Number.isFinite) ||
        box[2] <= 0 ||
        box[3] <= 0
      ) {
        throw new Error(`Invalid SVG viewBox in ${filename}.`);
      }
      const sourceScheme = SOURCE_SCHEMES[id];
      const prepared = prepareSvg(source, colorMaps[sourceScheme]);
      warnings.push(
        ...prepared.warnings.map((warning) => `${filename}: ${warning}`),
      );
      const isCanvas = id.startsWith('canvas');
      assets.push({
        id,
        size,
        kind: isCanvas ? 'canvas' : 'object',
        sourceScheme,
        width,
        height,
        viewBox,
        svg: prepared.svg,
        ...(!isCanvas
          ? { backgroundSvg: toBackgroundVariant(prepared.svg) }
          : {}),
      });
    }
  }
  if (
    assets.some(
      (asset) => asset.id === 'vase' && asset.svg.includes(roleToken('bg2')),
    )
  ) {
    warnings.push(
      'vase: bg2 is preserved; its background-variant rule is not confirmed (TODO).',
    );
  }
  return { manifest: { version: 1, assets }, warnings };
}
