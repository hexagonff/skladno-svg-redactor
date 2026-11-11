import { isImportedAssetId, type LibraryManifest } from './library';
import {
  getObjectGeometry,
  getObjectScaleForDimension,
} from './objectGeometry';
import { createSceneItem, type ObjectId } from './scene';

/** Manual additions and automatic layouts use exactly the same initial size. */
export function getDefaultObjectScale(
  assetId: ObjectId,
  manifest: LibraryManifest,
): number {
  const item = createSceneItem(assetId, 'default-object');
  const geometry = getObjectGeometry(item, manifest);
  if (!isImportedAssetId(assetId)) return item.scale;
  // Imported viewBoxes range from tiny icons to large illustrations.
  return getObjectScaleForDimension(
    item,
    manifest,
    geometry.width >= geometry.height ? 'width' : 'height',
    250,
  );
}
