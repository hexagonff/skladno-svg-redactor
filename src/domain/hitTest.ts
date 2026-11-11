import type { Point } from './geometry';
import type { LibraryManifest } from './library';
import { getObjectGeometry } from './objectGeometry';
import { assertScene, type Scene, type SceneItem } from './scene';

/** Pick the highest object by its SVG viewport, including unpainted areas.
 * Invalid scene or asset geometry throws; non-finite and off-canvas points miss.
 */
export function getSceneItemAtPoint(
  scene: Scene,
  manifest: LibraryManifest,
  point: Point,
): SceneItem | undefined {
  assertScene(scene);
  if (
    ![point.x, point.y].every(Number.isFinite) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > scene.width ||
    point.y > scene.height
  ) {
    return undefined;
  }

  for (let index = scene.items.length - 1; index >= 0; index -= 1) {
    const item = scene.items[index];
    const { width, height } = getObjectGeometry(item, manifest);
    const angle = ((item.rotation % 360) * Math.PI) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = point.x - item.x;
    const dy = point.y - item.y;
    // Invert the object's rotation; its source viewBox is centered when rendered.
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    // Include exact rotated edges despite floating-point roundoff.
    const tolerance =
      Number.EPSILON *
      16 *
      Math.max(
        1,
        width,
        height,
        Math.abs(item.x),
        Math.abs(item.y),
        Math.abs(point.x),
        Math.abs(point.y),
      );
    if (
      Math.abs(localX) <= width / 2 + tolerance &&
      Math.abs(localY) <= height / 2 + tolerance
    ) {
      return item;
    }
  }
  return undefined;
}
