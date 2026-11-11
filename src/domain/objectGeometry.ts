import type { Point } from './geometry';
import type { LibraryAsset, LibraryManifest } from './library';
import type { SceneItem } from './scene';

export type ObjectDimension = 'width' | 'height';
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface ObjectGeometry {
  asset: LibraryAsset;
  viewBox: readonly [number, number, number, number];
  width: number;
  height: number;
  // Effective uniform scale in units of the selected L or S source artwork.
  scale: number;
}

export interface ObjectResizeGesture {
  readonly initialScale: number;
  readonly anchor: Readonly<Point>;
  readonly diagonal: Readonly<Point>;
  readonly pointerOffset: Readonly<Point>;
  readonly minimumFactor: number;
}

function assetFor(
  manifest: LibraryManifest,
  item: SceneItem,
  size: SceneItem['size'],
): LibraryAsset {
  const matches = manifest.assets.filter(
    (asset) => asset.id === item.assetId && asset.size === size,
  );
  if (matches.length !== 1 || matches[0].kind !== 'object') {
    throw new Error(
      `Missing, duplicate or invalid object asset: ${item.assetId}__${size}.`,
    );
  }
  return matches[0];
}

function viewBoxFor(asset: LibraryAsset): ObjectGeometry['viewBox'] {
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
  return values as unknown as ObjectGeometry['viewBox'];
}

/** Each source keeps its own viewport size; scale is only a manual multiplier. */
export function getObjectGeometry(
  item: SceneItem,
  manifest: LibraryManifest,
): ObjectGeometry {
  if (!Number.isFinite(item.scale) || item.scale <= 0) {
    throw new Error('Object scale must be a positive finite number.');
  }
  const asset = assetFor(manifest, item, item.size);
  const viewBox = viewBoxFor(asset);
  const scale = item.scale;
  const width = asset.width * scale;
  const height = asset.height * scale;
  if (
    ![scale, width, height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error('Object dimensions must be positive finite numbers.');
  }
  return { asset, viewBox, width, height, scale };
}

/** Return a manual scale relative to this source; dimensions stay proportional. */
export function getObjectScaleForDimension(
  item: SceneItem,
  manifest: LibraryManifest,
  dimension: ObjectDimension,
  value: number,
): number {
  if (dimension !== 'width' && dimension !== 'height') {
    throw new Error(`Unknown object dimension: ${String(dimension)}.`);
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Object dimension must be a positive finite number.');
  }
  const geometry = getObjectGeometry(item, manifest);
  const scale = item.scale * (value / geometry[dimension]);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Object scale must be a positive finite number.');
  }
  // A finite requested dimension can still overflow the other axis.
  getObjectGeometry({ ...item, scale }, manifest);
  return scale;
}

function assertPoint(point: Readonly<Point>): void {
  if (![point.x, point.y].every(Number.isFinite)) {
    throw new Error('Resize position must contain finite numbers.');
  }
}

/** Capture the opposite corner and pointer offset before a resize gesture starts. */
export function startObjectResize(
  item: SceneItem,
  manifest: LibraryManifest,
  corner: ResizeCorner,
  pointer: Point,
): ObjectResizeGesture {
  if (!['nw', 'ne', 'sw', 'se'].includes(corner)) {
    throw new Error(`Unknown resize corner: ${String(corner)}.`);
  }
  assertPoint(pointer);
  assertPoint(item);
  if (!Number.isFinite(item.rotation)) {
    throw new Error('Object rotation must be finite.');
  }
  const { width, height } = getObjectGeometry(item, manifest);
  const angle = ((item.rotation % 360) * Math.PI) / 180;
  const localX = corner.endsWith('e') ? width : -width;
  const localY = corner.startsWith('s') ? height : -height;
  const diagonal = {
    x: localX * Math.cos(angle) - localY * Math.sin(angle),
    y: localX * Math.sin(angle) + localY * Math.cos(angle),
  };
  const anchor = {
    x: item.x - diagonal.x / 2,
    y: item.y - diagonal.y / 2,
  };
  const pointerOffset = {
    x: pointer.x - item.x - diagonal.x / 2,
    y: pointer.y - item.y - diagonal.y / 2,
  };
  assertPoint(diagonal);
  assertPoint(anchor);
  assertPoint(pointerOffset);
  return {
    initialScale: item.scale,
    anchor,
    diagonal,
    pointerOffset,
    minimumFactor: 1 / Math.min(width, height),
  };
}

/** Project onto the rotated diagonal, preventing distortion, flips, and collapse. */
export function resizeObjectFromPointer(
  gesture: ObjectResizeGesture,
  pointer: Point,
): { scale: number; position: Point } {
  assertPoint(pointer);
  const { anchor, diagonal, pointerOffset } = gesture;
  const length = Math.hypot(diagonal.x, diagonal.y);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('Resize diagonal must be a positive finite length.');
  }
  const projectedFactor =
    ((pointer.x - pointerOffset.x - anchor.x) / length) *
      (diagonal.x / length) +
    ((pointer.y - pointerOffset.y - anchor.y) / length) * (diagonal.y / length);
  const factor = Math.max(gesture.minimumFactor, projectedFactor);
  const scale = gesture.initialScale * factor;
  const position = {
    x: anchor.x + (diagonal.x * factor) / 2,
    y: anchor.y + (diagonal.y * factor) / 2,
  };
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Object scale must be a positive finite number.');
  }
  assertPoint(position);
  return { scale, position };
}
