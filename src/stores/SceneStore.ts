import { makeAutoObservable } from 'mobx';
import type { ColorRole } from '../domain/colors';
import type { CompositionPlan } from '../domain/composition';
import { getDefaultObjectScale } from '../domain/objectDefaults';
import { composeScene } from '../services/layout';
import type { Point } from '../domain/geometry';
import {
  isCustomSchemeId,
  isImportedAssetId,
  type AssetSize,
  type CanvasId,
  type ColorScheme,
  type LibraryManifest,
  type SchemeId,
} from '../domain/library';
import { getObjectGeometry } from '../domain/objectGeometry';
import {
  addSceneItem,
  assertScene,
  cloneSceneItem,
  createScene,
  createSceneItem,
  getSceneItemLayer,
  moveSceneItem,
  removeSceneItem,
  rotateSceneItem,
  ROTATION_STEP,
  resizeSceneItem,
  resetSceneItemColors,
  setSceneCanvas,
  setSceneItemSize,
  setSceneItemColor,
  setSceneItemRole,
  setSceneItemLayer,
  setSceneScheme,
  type ObjectId,
  type RotationDirection,
  type Scene,
  type SceneItem,
  type SceneRole,
} from '../domain/scene';

export class SceneStore {
  scene: Scene;
  selectedItemId: string | null = null;
  private nextItemNumber = 1;
  private issuedItemIds: Set<string>;

  readonly getManifest: (() => LibraryManifest) | undefined;
  readonly getSchemes: (() => readonly ColorScheme[]) | undefined;

  constructor(
    initialScene: Scene = createScene(),
    getManifest?: () => LibraryManifest,
    getSchemes?: () => readonly ColorScheme[],
  ) {
    this.getManifest = getManifest;
    this.getSchemes = getSchemes;
    assertScene(initialScene);
    this.assertRegisteredScheme(initialScene.schemeId);
    this.scene = {
      ...initialScene,
      items: initialScene.items.map(cloneSceneItem),
    };
    this.issuedItemIds = new Set(initialScene.items.map((item) => item.id));
    for (const item of this.scene.items) {
      if (getManifest) getObjectGeometry(item, getManifest());
      else if (isImportedAssetId(item.assetId))
        throw new Error('Imported objects require a registered library.');
    }
    makeAutoObservable(
      this,
      { getManifest: false, getSchemes: false },
      { autoBind: true },
    );
  }

  get selectedItem(): SceneItem | undefined {
    return this.scene.items.find((item) => item.id === this.selectedItemId);
  }

  get selectedLayer(): number | null {
    return this.selectedItemId === null
      ? null
      : getSceneItemLayer(this.scene, this.selectedItemId);
  }

  get canRaiseSelected(): boolean {
    return (
      this.selectedLayer !== null &&
      this.selectedLayer < this.scene.items.length
    );
  }

  get canLowerSelected(): boolean {
    return this.selectedLayer !== null && this.selectedLayer > 1;
  }

  setItemLayer(id: string, layer: number): void {
    this.scene = setSceneItemLayer(this.scene, id, layer);
  }

  setSelectedLayer(layer: number): void {
    if (this.selectedItemId === null) return;
    this.setItemLayer(this.selectedItemId, layer);
  }

  moveSelectedLayer(direction: 'up' | 'down'): void {
    if (this.selectedItemId === null) return;
    if (direction === 'up') {
      if (this.canRaiseSelected) this.setSelectedLayer(this.selectedLayer! + 1);
    } else if (direction === 'down') {
      if (this.canLowerSelected) this.setSelectedLayer(this.selectedLayer! - 1);
    } else {
      throw new Error(`Unknown layer direction: ${direction}`);
    }
  }

  addItem(assetId: ObjectId): void {
    let nextNumber = this.nextItemNumber;
    while (this.issuedItemIds.has(`item-${nextNumber}`)) {
      nextNumber += 1;
    }
    const offset =
      (this.scene.items.filter((item) => item.assetId === assetId).length % 5) *
      24;
    const item = createSceneItem(assetId, `item-${nextNumber}`, {
      x: this.scene.width / 2 + offset,
      y: this.scene.height / 2 + offset,
    });
    if (this.getManifest) {
      item.scale = getDefaultObjectScale(assetId, this.getManifest());
    } else if (isImportedAssetId(assetId)) {
      throw new Error('Imported objects require a registered library.');
    }
    this.scene = addSceneItem(this.scene, item);
    this.issuedItemIds.add(item.id);
    this.nextItemNumber = nextNumber + 1;
    this.selectedItemId = item.id;
  }

  applyComposition(plan: CompositionPlan, seed = 0): void {
    if (!this.getManifest) {
      throw new Error('Для автоматической сборки требуется каталог объектов.');
    }
    const composed = composeScene(this.scene, this.getManifest(), plan, seed);
    let nextNumber = this.nextItemNumber;
    const reserved = new Set(this.issuedItemIds);
    const items = composed.items.map((item) => {
      while (reserved.has(`item-${nextNumber}`)) nextNumber += 1;
      const id = `item-${nextNumber++}`;
      reserved.add(id);
      return { ...item, id };
    });
    // All validation and packing above completes before observable state changes.
    this.scene = { ...composed, items };
    this.issuedItemIds = reserved;
    this.nextItemNumber = nextNumber;
    this.selectedItemId = null;
  }

  selectItem(id: string | null): void {
    if (id !== null && !this.scene.items.some((item) => item.id === id)) {
      throw new Error(`Unknown scene item: ${id}`);
    }
    this.selectedItemId = id;
  }

  moveItem(id: string, position: { x: number; y: number }): void {
    this.scene = moveSceneItem(this.scene, id, position);
  }

  resizeItem(id: string, scale: number, position?: Point): void {
    this.scene = resizeSceneItem(this.scene, id, scale, position);
  }

  setSelectedScale(scale: number): void {
    if (this.selectedItemId === null) return;
    this.resizeItem(this.selectedItemId, scale);
  }

  rotateSelected(direction: RotationDirection): void {
    if (this.selectedItemId === null) return;
    if (direction !== 'clockwise' && direction !== 'counterclockwise') {
      throw new Error(`Unknown rotation direction: ${direction}`);
    }
    this.scene = rotateSceneItem(
      this.scene,
      this.selectedItemId,
      direction === 'clockwise' ? ROTATION_STEP : -ROTATION_STEP,
    );
  }

  deleteSelectedItem(): void {
    if (this.selectedItemId === null) return;
    this.scene = removeSceneItem(this.scene, this.selectedItemId);
    this.selectedItemId = null;
  }

  setSelectedSize(size: AssetSize): void {
    if (this.selectedItemId === null) return;
    if (this.getManifest && this.selectedItem) {
      getObjectGeometry({ ...this.selectedItem, size }, this.getManifest());
    }
    this.scene = setSceneItemSize(this.scene, this.selectedItemId, size);
  }

  setCanvas(id: CanvasId): void {
    this.scene = setSceneCanvas(this.scene, id);
  }

  setScheme(id: SchemeId): void {
    this.assertRegisteredScheme(id);
    this.scene = setSceneScheme(this.scene, id);
  }

  private assertRegisteredScheme(id: SchemeId): void {
    if (this.getSchemes) {
      if (this.getSchemes().filter((scheme) => scheme.id === id).length !== 1) {
        throw new Error(`Unknown or ambiguous color scheme: ${id}`);
      }
    } else if (isCustomSchemeId(id)) {
      throw new Error(
        'Custom color schemes require a registered scheme catalog.',
      );
    }
  }

  setSelectedRole(role: SceneRole): void {
    if (this.selectedItemId === null) return;
    this.scene = setSceneItemRole(this.scene, this.selectedItemId, role);
  }
  setSelectedColor(source: ColorRole, target: ColorRole): void {
    if (this.selectedItemId === null) return;
    this.scene = setSceneItemColor(
      this.scene,
      this.selectedItemId,
      source,
      target,
    );
  }

  resetSelectedColors(): void {
    if (this.selectedItemId === null) return;
    this.scene = resetSceneItemColors(this.scene, this.selectedItemId);
  }
}
