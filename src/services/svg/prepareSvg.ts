import { parseRoleToken, roleToken } from '../../domain/colors';
import type { ColorMap } from '../../domain/colors';
import { normalizeColor } from './normalizeColor';
import { mapSvgPaint } from './svgDocument';

export interface PreparedSvg {
  svg: string;
  warnings: string[];
}

/** Assigns roles using only the palette supplied for this independent asset. */
export function prepareSvg(svg: string, colorMap: ColorMap): PreparedSvg {
  const normalizedMap = new Map<string, ColorMap[string]>();
  for (const [color, role] of Object.entries(colorMap)) {
    const normalized = normalizeColor(color);
    if (normalized === undefined) {
      throw new Error(
        `Color map contains a non-opaque or unsupported color: ${color}`,
      );
    }
    const existing = normalizedMap.get(normalized);
    if (existing !== undefined && existing !== role) {
      throw new Error(
        `Color ${normalized} has conflicting roles: ${existing}, ${role}`,
      );
    }
    normalizedMap.set(normalized, role);
  }

  const warnings = new Set<string>();
  const prepared = mapSvgPaint(svg, (value) => {
    const paint = value.trim();
    if (
      /^(?:none|currentcolor|inherit|initial|unset|revert|revert-layer)$/i.test(
        paint,
      ) ||
      /^url\(/i.test(paint) ||
      parseRoleToken(paint) !== undefined
    ) {
      return value;
    }

    const normalized = normalizeColor(paint);
    const role =
      normalized === undefined ? undefined : normalizedMap.get(normalized);
    if (role !== undefined) return roleToken(role);
    warnings.add(`Unmapped SVG paint: ${normalized ?? paint}`);
    return value;
  });

  return { svg: prepared, warnings: [...warnings] };
}
