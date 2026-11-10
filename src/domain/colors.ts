export const COLOR_ROLES = [
  'bg1',
  'bg2',
  'bg3',
  'black',
  'obj1',
  'obj2',
  'obj3',
  'white',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export type ColorMap = Readonly<Record<string, ColorRole>>;

export function roleToken(role: ColorRole): string {
  return `var(--${role})`;
}

export function parseRoleToken(value: string): ColorRole | undefined {
  const token = value.trim();
  return COLOR_ROLES.find((role) => roleToken(role) === token);
}
