import type { Element } from '@xmldom/xmldom';
import { COLOR_ROLES, parseRoleToken } from '../../domain/colors';
import type {
  AssetId,
  AssetSize,
  ColorScheme,
  LibraryAsset,
  LibraryManifest,
} from '../../domain/library';
import {
  assertObjectColorOverrides,
  type ObjectColorOverrides,
} from '../../domain/objectColors';
import { getObjectGeometry } from '../../domain/objectGeometry';
import type { Scene, SceneRole } from '../../domain/scene';
import { normalizeColor } from './normalizeColor';
import { prefixSvgIds } from './prefixSvgIds';
import {
  mapSvgPaint,
  parseSvg,
  serializeSvg,
  visitSvgElements,
} from './svgDocument';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
type ViewBox = readonly [number, number, number, number];

function viewBoxFor(asset: LibraryAsset): ViewBox {
  const values = asset.viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[2] <= 0 ||
    values[3] <= 0 ||
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0
  ) {
    throw new Error(`Invalid SVG geometry: ${asset.id}__${asset.size}.`);
  }
  return values as unknown as ViewBox;
}

/** Hex code points keep namespaces unambiguous even for punctuation and Unicode. */
function encodeIdentifier(value: string): string {
  return Array.from(value, (character) =>
    character.codePointAt(0)!.toString(16),
  ).join('_');
}

function assertNamespace(namespace: string): void {
  if (!namespace.trim()) throw new Error('SVG namespace must not be empty.');
}

function materializeAsset(
  asset: LibraryAsset,
  scheme: ColorScheme,
  prefix: string,
  role: SceneRole,
  overrides?: ObjectColorOverrides,
): string {
  viewBoxFor(asset);
  if (role !== 'main' && role !== 'bg') {
    throw new Error(`Unknown scene role: ${String(role)}.`);
  }
  assertObjectColorOverrides(overrides, role);
  const source = role === 'bg' ? asset.backgroundSvg : asset.svg;
  if (source === undefined) {
    throw new Error(`Missing background variant: ${asset.id}__${asset.size}.`);
  }
  const colors = new Map(
    COLOR_ROLES.map((colorRole) => {
      const color = normalizeColor(scheme.colors[colorRole]);
      if (color === undefined) {
        throw new Error(`Invalid color for ${scheme.id}.${colorRole}.`);
      }
      return [colorRole, color] as const;
    }),
  );
  const painted = mapSvgPaint(source, (paint) => {
    const colorRole = parseRoleToken(paint);
    // Resolve from the original role once, so swaps never cascade.
    if (colorRole !== undefined) {
      return colors.get(overrides?.[colorRole] ?? colorRole)!;
    }
    if (/var\s*\(/i.test(paint)) {
      throw new Error(`Unresolved SVG paint token: ${paint}.`);
    }
    return paint;
  });
  const document = parseSvg(prefixSvgIds(painted, prefix));
  const root = document.documentElement!;
  root.setAttribute('xmlns', SVG_NAMESPACE);
  visitSvgElements(root, (element) => {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)!;
      if (/var\s*\(/i.test(attribute.value)) {
        throw new Error(`Unresolved SVG token: ${attribute.value}.`);
      }
      if (
        ['href', 'xlink:href'].includes(attribute.name.toLowerCase()) &&
        attribute.value &&
        !attribute.value.startsWith('#')
      ) {
        throw new Error(
          `External SVG references are forbidden: ${attribute.value}.`,
        );
      }
    }
  });
  return serializeSvg(document);
}

/** The same literal-color SVG is used by library previews and exported scenes. */
export function renderAssetSvg(
  asset: LibraryAsset,
  scheme: ColorScheme,
  namespace: string,
  role: SceneRole = 'main',
  overrides?: ObjectColorOverrides,
): string {
  assertNamespace(namespace);
  return materializeAsset(
    asset,
    scheme,
    `asset_${encodeIdentifier(namespace)}`,
    role,
    overrides,
  );
}

function assetFor(
  manifest: LibraryManifest,
  id: AssetId,
  size: AssetSize,
  kind: LibraryAsset['kind'],
): LibraryAsset {
  const matches = manifest.assets.filter(
    (asset) => asset.id === id && asset.size === size,
  );
  if (matches.length !== 1 || matches[0].kind !== kind) {
    throw new Error(
      `Missing, duplicate or invalid ${kind} asset: ${id}__${size}.`,
    );
  }
  return matches[0];
}

/** Preserve root styles/definitions; make the nested viewport identity in asset units. */
function viewportFor(svg: string, box: ViewBox): Element {
  const root = parseSvg(svg).documentElement!;
  root.setAttribute('x', String(box[0]));
  root.setAttribute('y', String(box[1]));
  root.setAttribute('width', String(box[2]));
  root.setAttribute('height', String(box[3]));
  root.setAttribute('viewBox', box.join(' '));
  return root;
}

/** Build the complete scene once, for both the on-screen canvas and SVG download. */
export function renderScene(
  scene: Scene,
  manifest: LibraryManifest,
  schemes: readonly ColorScheme[],
  namespace: string,
): string {
  assertNamespace(namespace);
  if (
    !Number.isFinite(scene.width) ||
    !Number.isFinite(scene.height) ||
    scene.width <= 0 ||
    scene.height <= 0
  ) {
    throw new Error('Scene dimensions must be positive finite numbers.');
  }
  const matchingSchemes = schemes.filter(
    (scheme) => scheme.id === scene.schemeId,
  );
  if (matchingSchemes.length !== 1) {
    throw new Error(`Unknown or duplicate color scheme: ${scene.schemeId}.`);
  }
  const scheme = matchingSchemes[0];
  const prefix = `scene_${encodeIdentifier(namespace)}`;
  const document = parseSvg(`<svg xmlns="${SVG_NAMESPACE}"/>`);
  const root = document.documentElement!;
  root.setAttribute('width', String(scene.width));
  root.setAttribute('height', String(scene.height));
  root.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
  root.setAttribute('overflow', 'hidden');

  const appendAsset = (
    asset: LibraryAsset,
    box: ViewBox,
    transform: string,
    instancePrefix: string,
    role: SceneRole,
    attributes: Readonly<Record<string, string>>,
    overrides?: ObjectColorOverrides,
  ): void => {
    const group = document.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('transform', transform);
    for (const [key, value] of Object.entries(attributes)) {
      group.setAttribute(key, value);
    }
    const svg = materializeAsset(
      asset,
      scheme,
      instancePrefix,
      role,
      overrides,
    );
    group.appendChild(document.importNode(viewportFor(svg, box), true));
    root.appendChild(group);
  };

  const canvas = assetFor(manifest, scene.canvasId, scene.canvasSize, 'canvas');
  const canvasBox = viewBoxFor(canvas);
  const canvasScale = Math.max(
    scene.width / canvasBox[2],
    scene.height / canvasBox[3],
  );
  appendAsset(
    canvas,
    canvasBox,
    `translate(${scene.width / 2} ${scene.height / 2}) scale(${canvasScale}) translate(${-canvasBox[0] - canvasBox[2] / 2} ${-canvasBox[1] - canvasBox[3] / 2})`,
    `${prefix}_canvas`,
    'main',
    { 'data-canvas-id': canvas.id, 'data-detail-size': scene.canvasSize },
  );

  const instanceIds = new Set<string>();
  for (const item of scene.items) {
    if (!item.id || instanceIds.has(item.id)) {
      throw new Error(`Empty or duplicate scene item id: ${item.id}.`);
    }
    instanceIds.add(item.id);
    if (
      ![item.x, item.y, item.scale, item.rotation].every(Number.isFinite) ||
      item.scale <= 0
    ) {
      throw new Error(`Invalid scene item geometry: ${item.id}.`);
    }
    const { asset, viewBox: box, scale } = getObjectGeometry(item, manifest);
    appendAsset(
      asset,
      box,
      `translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${scale}) translate(${-box[0] - box[2] / 2} ${-box[1] - box[3] / 2})`,
      `${prefix}_item_${encodeIdentifier(item.id)}`,
      item.role,
      {
        'data-item-id': item.id,
        'data-asset-id': asset.id,
        'data-detail-size': item.size,
      },
      item.colorOverrides?.[item.role],
    );
  }
  return serializeSvg(document);
}
