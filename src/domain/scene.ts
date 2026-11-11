import type { ColorRole } from './colors';
import type { Point } from './geometry';
import {
  ASSET_IDS,
  ASSET_SIZES,
  CANVAS_IDS,
  SCHEME_IDS,
  isImportedAssetId,
  isCustomSchemeId,
  type AssetId,
  type AssetSize,
  type CanvasId,
  type SchemeId,
} from './library';
import {
  assertObjectColorOverrides,
  type ObjectColorOverrides,
} from './objectColors';

export type ObjectId = Exclude<AssetId, CanvasId>;
export type SceneRole = 'main' | 'bg';
export type RotationDirection = 'clockwise' | 'counterclockwise';
export const ROTATION_STEP = 15;

export interface SceneItem {
  id: string;
  assetId: ObjectId;
  size: AssetSize;
  role: SceneRole;
  colorOverrides?: Partial<Record<SceneRole, ObjectColorOverrides>>;
  x: number;
  y: number;
  // Manual uniform scale relative to the selected source SVG viewport.
  scale: number;
  rotation: number;
}

export interface Scene {
  width: number;
  height: number;
  canvasId: CanvasId;
  canvasSize: AssetSize;
  schemeId: SchemeId;
  // SVG paint order: the first item is lowest, the last item is highest.
  items: SceneItem[];
}

const objectIds: readonly string[] = ASSET_IDS.filter(
  (id) => !id.startsWith('canvas'),
);

function assertItem(item: SceneItem): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id)) {
    throw new Error('Scene item ID must be a safe, nonempty SVG identifier.');
  }
  if (!objectIds.includes(item.assetId) && !isImportedAssetId(item.assetId)) {
    throw new Error(`Unknown object asset: ${item.assetId}`);
  }
  if (!ASSET_SIZES.includes(item.size)) {
    throw new Error(`Unknown object size: ${item.size}`);
  }
  if (item.role !== 'main' && item.role !== 'bg') {
    throw new Error(`Unknown scene role: ${item.role}`);
  }
  if (item.colorOverrides !== undefined) {
    if (
      typeof item.colorOverrides !== 'object' ||
      item.colorOverrides === null ||
      Array.isArray(item.colorOverrides)
    ) {
      throw new Error(
        'Scene item color overrides must be a map of scene roles.',
      );
    }
    for (const [role, overrides] of Object.entries(item.colorOverrides)) {
      if (role !== 'main' && role !== 'bg') {
        throw new Error(`Unknown color override scene role: ${role}`);
      }
      assertObjectColorOverrides(overrides, role);
    }
  }
  if (![item.x, item.y, item.rotation].every(Number.isFinite)) {
    throw new Error('Scene position and rotation must be finite numbers.');
  }
  if (!Number.isFinite(item.scale) || item.scale <= 0) {
    throw new Error('Scene scale must be a positive finite number.');
  }
}

export function assertScene(scene: Scene): void {
  if (
    ![scene.width, scene.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error('Scene dimensions must be positive finite numbers.');
  }
  if (!CANVAS_IDS.includes(scene.canvasId)) {
    throw new Error(`Unknown canvas asset: ${scene.canvasId}`);
  }
  if (!ASSET_SIZES.includes(scene.canvasSize)) {
    throw new Error(`Unknown canvas size: ${scene.canvasSize}`);
  }
  if (
    !(SCHEME_IDS as readonly string[]).includes(scene.schemeId) &&
    !isCustomSchemeId(scene.schemeId)
  ) {
    throw new Error(`Unknown color scheme: ${scene.schemeId}`);
  }

  const ids = new Set<string>();
  for (const item of scene.items) {
    assertItem(item);
    if (ids.has(item.id)) {
      throw new Error(`Duplicate scene item ID: ${item.id}`);
    }
    ids.add(item.id);
  }
}

export function createScene(): Scene {
  return {
    width: 1000,
    height: 1000,
    canvasId: 'canvas1',
    canvasSize: 'L',
    schemeId: 'purple',
    items: [],
  };
}

export function createSceneItem(
  assetId: ObjectId,
  id: string,
  position: { x: number; y: number } = { x: 500, y: 500 },
): SceneItem {
  const item: SceneItem = {
    id,
    assetId,
    size: 'L',
    role: 'main',
    ...position,
    scale: 1,
    rotation: 0,
  };
  assertItem(item);
  return item;
}

export function cloneSceneItem(item: SceneItem): SceneItem {
  const clone = { ...item };
  if (item.colorOverrides !== undefined) {
    clone.colorOverrides = {};
    for (const role of ['main', 'bg'] as const) {
      const overrides = item.colorOverrides[role];
      if (overrides !== undefined) {
        clone.colorOverrides[role] = { ...overrides };
      }
    }
  }
  return clone;
}

export function addSceneItem(scene: Scene, item: SceneItem): Scene {
  assertScene(scene);
  assertItem(item);
  if (scene.items.some((current) => current.id === item.id)) {
    throw new Error(`Duplicate scene item ID: ${item.id}`);
  }
  return { ...scene, items: [...scene.items, cloneSceneItem(item)] };
}

export function duplicateSceneItem(
  scene: Scene,
  sourceId: string,
  newId: string,
): Scene {
  assertScene(scene);
  const index = scene.items.findIndex((item) => item.id === sourceId);
  if (index === -1) {
    throw new Error(`Unknown scene item: ${sourceId}`);
  }
  if (typeof newId !== 'string') {
    throw new Error('Scene item ID must be a safe, nonempty SVG identifier.');
  }
  const source = scene.items[index];
  const offset = Math.min(scene.width, scene.height) * 0.016;
  const shiftCoordinate = (value: number, extent: number): number => {
    const step =
      value >= 0 && value <= extent && value > extent - offset
        ? -offset
        : offset;
    const shifted = value + step;
    return Number.isFinite(shifted) ? shifted : value - step;
  };
  const copy = cloneSceneItem({
    ...source,
    id: newId,
    x: shiftCoordinate(source.x, scene.width),
    y: shiftCoordinate(source.y, scene.height),
  });
  assertItem(copy);
  if (scene.items.some((item) => item.id === newId)) {
    throw new Error(`Duplicate scene item ID: ${newId}`);
  }
  return {
    ...scene,
    items: [
      ...scene.items.slice(0, index + 1),
      copy,
      ...scene.items.slice(index + 1),
    ],
  };
}

export function getSceneItemLayer(scene: Scene, itemId: string): number {
  assertScene(scene);
  const index = scene.items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return index + 1;
}

export function setSceneItemLayer(
  scene: Scene,
  itemId: string,
  layer: number,
): Scene {
  const currentLayer = getSceneItemLayer(scene, itemId);
  if (!Number.isInteger(layer) || layer < 1 || layer > scene.items.length) {
    throw new Error(
      `Scene item layer must be an integer from 1 to ${scene.items.length}.`,
    );
  }
  if (currentLayer === layer) return scene;

  const items = [...scene.items];
  const [item] = items.splice(currentLayer - 1, 1);
  items.splice(layer - 1, 0, item);
  return { ...scene, items };
}

export function setSceneItemSize(
  scene: Scene,
  itemId: string,
  size: AssetSize,
): Scene {
  assertScene(scene);
  if (!ASSET_SIZES.includes(size)) {
    throw new Error(`Unknown object size: ${size}`);
  }
  if (!scene.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.id === itemId ? { ...item, size, scale: 1 } : item,
    ),
  };
}

export function setSceneCanvas(scene: Scene, canvasId: CanvasId): Scene {
  assertScene(scene);
  if (!CANVAS_IDS.includes(canvasId)) {
    throw new Error(`Unknown canvas asset: ${canvasId}`);
  }
  return { ...scene, canvasId };
}

export function setSceneCanvasSize(
  scene: Scene,
  size: AssetSize,
  dimensions = {
    width: size === 'L' ? 1000 : 500,
    height: size === 'L' ? 1000 : 500,
  },
): Scene {
  assertScene(scene);
  if (!ASSET_SIZES.includes(size)) {
    throw new Error(`Unknown canvas size: ${size}`);
  }
  if (
    ![dimensions.width, dimensions.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error('Canvas dimensions must be positive finite numbers.');
  }
  const ratioX = dimensions.width / scene.width;
  const ratioY = dimensions.height / scene.height;
  const next = {
    ...scene,
    canvasSize: size,
    ...dimensions,
    items: scene.items.map((item) => ({
      ...item,
      x: item.x * ratioX,
      y: item.y * ratioY,
    })),
  };
  assertScene(next);
  return next;
}

export function setSceneScheme(scene: Scene, schemeId: SchemeId): Scene {
  assertScene(scene);
  if (
    !(SCHEME_IDS as readonly string[]).includes(schemeId) &&
    !isCustomSchemeId(schemeId)
  ) {
    throw new Error(`Unknown color scheme: ${schemeId}`);
  }
  return { ...scene, schemeId };
}

export function setSceneItemRole(
  scene: Scene,
  itemId: string,
  role: SceneRole,
): Scene {
  assertScene(scene);
  if (role !== 'main' && role !== 'bg') {
    throw new Error(`Unknown scene role: ${role}`);
  }
  if (!scene.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.id === itemId ? { ...item, role } : item,
    ),
  };
}

export function moveSceneItem(
  scene: Scene,
  itemId: string,
  position: { x: number; y: number },
): Scene {
  assertScene(scene);
  if (![position.x, position.y].every(Number.isFinite)) {
    throw new Error('Scene position must contain finite numbers.');
  }
  if (!scene.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.id === itemId ? { ...item, x: position.x, y: position.y } : item,
    ),
  };
}

export function rotateSceneItem(
  scene: Scene,
  itemId: string,
  deltaDegrees: number,
): Scene {
  assertScene(scene);
  if (!Number.isFinite(deltaDegrees)) {
    throw new Error('Scene rotation delta must be a finite number.');
  }
  const selected = scene.items.find((item) => item.id === itemId);
  if (selected === undefined) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }

  const normalize = (angle: number): number => {
    const remainder = angle % 360;
    return remainder < 0
      ? (remainder + 360) % 360
      : remainder === 0
        ? 0
        : remainder;
  };
  // Reduce both operands before addition so any finite input stays finite.
  const rotation = normalize(
    normalize(selected.rotation) + normalize(deltaDegrees),
  );
  if (selected.rotation === rotation) return scene;

  return {
    ...scene,
    items: scene.items.map((item) =>
      item.id === itemId ? { ...item, rotation } : item,
    ),
  };
}

export function resizeSceneItem(
  scene: Scene,
  itemId: string,
  scale: number,
  position?: Point,
): Scene {
  assertScene(scene);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Scene scale must be a positive finite number.');
  }
  if (
    position !== undefined &&
    ![position.x, position.y].every(Number.isFinite)
  ) {
    throw new Error('Scene position must contain finite numbers.');
  }
  if (!scene.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            scale,
            ...(position === undefined ? {} : { x: position.x, y: position.y }),
          }
        : item,
    ),
  };
}

export function removeSceneItem(scene: Scene, itemId: string): Scene {
  assertScene(scene);
  if (!scene.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return {
    ...scene,
    items: scene.items.filter((item) => item.id !== itemId),
  };
}

export function setSceneItemColor(
  scene: Scene,
  itemId: string,
  sourceRole: ColorRole,
  targetRole: ColorRole,
): Scene {
  assertScene(scene);
  const selected = scene.items.find((item) => item.id === itemId);
  if (selected === undefined) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  assertObjectColorOverrides({ [sourceRole]: targetRole }, selected.role);
  const overrides = {
    ...selected.colorOverrides?.[selected.role],
  };
  if (sourceRole === targetRole) {
    delete overrides[sourceRole];
  } else {
    overrides[sourceRole] = targetRole;
  }
  return replaceItemColors(scene, selected, overrides);
}

export function resetSceneItemColors(scene: Scene, itemId: string): Scene {
  assertScene(scene);
  const selected = scene.items.find((item) => item.id === itemId);
  if (selected === undefined) {
    throw new Error(`Unknown scene item: ${itemId}`);
  }
  return replaceItemColors(scene, selected, {});
}

function replaceItemColors(
  scene: Scene,
  selected: SceneItem,
  overrides: ObjectColorOverrides,
): Scene {
  const colorOverrides = { ...selected.colorOverrides };
  if (Object.keys(overrides).length === 0) {
    delete colorOverrides[selected.role];
  } else {
    colorOverrides[selected.role] = overrides;
  }
  const replacement = { ...selected };
  if (Object.keys(colorOverrides).length === 0) {
    delete replacement.colorOverrides;
  } else {
    replacement.colorOverrides = colorOverrides;
  }
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.id === selected.id ? replacement : item,
    ),
  };
}
