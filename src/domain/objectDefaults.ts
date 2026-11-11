import type { LibraryManifest } from './library';
import { getObjectGeometry } from './objectGeometry';
import { createSceneItem, type ObjectId } from './scene';

/** New objects, including imports, use the source viewport at 100%. */
export function getDefaultObjectScale(
  assetId: ObjectId,
  manifest: LibraryManifest,
): number {
  const item = createSceneItem(assetId, 'default-object');
  getObjectGeometry(item, manifest);
  return 1;
}
