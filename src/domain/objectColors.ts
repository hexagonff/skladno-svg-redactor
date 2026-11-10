import type { ColorRole } from './colors';

export const EDITABLE_COLOR_ROLES = [
  'bg1',
  'bg2',
  'bg3',
  'obj1',
  'obj2',
  'obj3',
] as const;

export const BACKGROUND_COLOR_ROLES = ['bg1', 'bg2', 'bg3'] as const;

export type ObjectColorOverrides = Partial<Record<ColorRole, ColorRole>>;

export function getEditableColorRoles(
  role: 'main' | 'bg',
): readonly ColorRole[] {
  if (role === 'main') return EDITABLE_COLOR_ROLES;
  if (role === 'bg') return BACKGROUND_COLOR_ROLES;
  throw new Error(`Unknown scene role: ${role}`);
}

export function assertObjectColorOverrides(
  overrides: ObjectColorOverrides | undefined,
  role: 'main' | 'bg',
): void {
  const allowed = getEditableColorRoles(role);
  if (overrides === undefined) return;
  if (
    typeof overrides !== 'object' ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new Error('Object color overrides must be a role-to-role map.');
  }
  for (const [source, target] of Object.entries(overrides)) {
    if (!allowed.includes(source as ColorRole)) {
      throw new Error(
        `Color source ${source} is not allowed for ${role} objects.`,
      );
    }
    if (!allowed.includes(target)) {
      throw new Error(
        `Color target ${target} is not allowed for ${role} objects.`,
      );
    }
  }
}
