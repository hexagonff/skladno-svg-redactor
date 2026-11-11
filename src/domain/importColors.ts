import { COLOR_ROLES, type ColorRole } from './colors';
import { EDITABLE_COLOR_ROLES } from './objectColors';

export interface ImportedColorAssignment {
  colorMap: Record<string, ColorRole>;
  /** Additional unique source colors sharing an editable role. */
  mergedColorCount: number;
}

function normalizeHex(color: string): string {
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color.trim())) {
    throw new Error(
      'Imported colors and palette colors must be #RRGGBB hex values.',
    );
  }
  return color.trim().toUpperCase();
}

function rgbDistance(left: string, right: string): number {
  let distance = 0;
  for (const offset of [1, 3, 5]) {
    const difference =
      Number.parseInt(left.slice(offset, offset + 2), 16) -
      Number.parseInt(right.slice(offset, offset + 2), 16);
    distance += difference * difference;
  }
  return distance;
}

interface AssignmentState {
  distance: number;
  roles: ColorRole[];
}

/**
 * Match colors within one source scheme. Exact colors keep their roles, and
 * repeated source hex values share one assignment. Unknown colors use separate
 * editable roles where possible, minimizing the total squared RGB distance.
 */
export function assignImportedColorRoles(
  colors: readonly string[],
  schemeColors: Readonly<Record<ColorRole, string>>,
): ImportedColorAssignment {
  if (!Array.isArray(colors))
    throw new Error('Imported colors must be an array.');
  if (
    !schemeColors ||
    typeof schemeColors !== 'object' ||
    Array.isArray(schemeColors)
  ) {
    throw new Error('A source palette with all color roles is required.');
  }
  const palette = Object.fromEntries(
    COLOR_ROLES.map((role) => [role, normalizeHex(schemeColors[role])]),
  ) as Record<ColorRole, string>;
  const uniqueColors = [...new Set(colors.map(normalizeHex))].sort();
  const colorMap: Record<string, ColorRole> = {};
  const reserved = new Set<ColorRole>();
  const unknownColors: string[] = [];

  for (const color of uniqueColors) {
    const exactRole =
      color === '#000000' || color === '#181817'
        ? 'black'
        : color === '#FFFFFF'
          ? 'white'
          : COLOR_ROLES.find((role) => palette[role] === color);
    if (exactRole) {
      colorMap[color] = exactRole;
      reserved.add(exactRole);
    } else {
      unknownColors.push(color);
    }
  }

  const availableRoles = EDITABLE_COLOR_ROLES.filter(
    (role) => !reserved.has(role),
  );
  const canMerge = unknownColors.length > availableRoles.length;
  let states = new Map<number, AssignmentState>([
    [0, { distance: 0, roles: [] }],
  ]);

  for (const color of unknownColors) {
    const nextStates = new Map<number, AssignmentState>();
    const distance = (role: ColorRole): number =>
      rgbDistance(color, palette[role]);
    const nearestRole = EDITABLE_COLOR_ROLES.reduce((nearest, role) =>
      distance(role) < distance(nearest) ? role : nearest,
    );
    const keep = (
      mask: number,
      state: AssignmentState,
      role: ColorRole,
    ): void => {
      const candidateDistance = state.distance + distance(role);
      const current = nextStates.get(mask);
      // Colors and role traversal have fixed orders, so ties are deterministic.
      if (!current || candidateDistance < current.distance) {
        nextStates.set(mask, {
          distance: candidateDistance,
          roles: [...state.roles, role],
        });
      }
    };
    for (const [mask, state] of states) {
      if (canMerge) keep(mask, state, nearestRole);
      availableRoles.forEach((role, index) => {
        const bit = 1 << index;
        if (!(mask & bit)) keep(mask | bit, state, role);
      });
    }
    states = nextStates;
  }

  const targetCount = Math.min(unknownColors.length, availableRoles.length);
  const usedCount = (mask: number): number => {
    let count = 0;
    for (let value = mask; value; value &= value - 1) count += 1;
    return count;
  };
  let best: AssignmentState | undefined;
  for (const [mask, state] of states) {
    if (usedCount(mask) !== targetCount) continue;
    if (!best || state.distance < best.distance) best = state;
  }
  if (!best)
    throw new Error('Could not assign imported colors to palette roles.');
  unknownColors.forEach((color, index) => {
    colorMap[color] = best.roles[index];
  });

  return {
    colorMap,
    mergedColorCount: Math.max(0, unknownColors.length - availableRoles.length),
  };
}
