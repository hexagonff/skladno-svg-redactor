import { parseRoleToken, type ColorRole } from '../../domain/colors';
import type { LibraryAsset } from '../../domain/library';
import { getEditableColorRoles } from '../../domain/objectColors';
import type { SceneRole } from '../../domain/scene';
import { mapSvgPaint } from './svgDocument';

/** Return editable paints actually used by this independent L/S artwork. */
export function getAssetColorRoles(
  asset: LibraryAsset,
  role: SceneRole = 'main',
): ColorRole[] {
  const editableRoles = getEditableColorRoles(role);
  const source = role === 'bg' ? asset.backgroundSvg : asset.svg;
  if (source === undefined) {
    throw new Error(`Missing background variant: ${asset.id}__${asset.size}.`);
  }
  const used = new Set<ColorRole>();
  mapSvgPaint(source, (paint) => {
    const colorRole = parseRoleToken(paint);
    if (colorRole !== undefined) used.add(colorRole);
    return paint;
  });
  return editableRoles.filter((colorRole) => used.has(colorRole));
}
