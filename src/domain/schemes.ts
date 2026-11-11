import { COLOR_ROLES, type ColorRole } from './colors';
import {
  isCustomSchemeId,
  type ColorScheme,
  type CustomSchemeId,
} from './library';

export const SCHEME_NAME_MAX_LENGTH = 80;

/** Opaque HEX input only; built-in artwork normalization has a broader SVG grammar. */
export function normalizeSchemeColor(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return undefined;
  const hex = match[1];
  return `#${(hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex).toUpperCase()}`;
}

export function createCustomScheme(
  id: CustomSchemeId,
  name: string,
  colors: Readonly<Record<ColorRole, string>>,
): ColorScheme {
  if (!isCustomSchemeId(id)) {
    throw new Error('Некорректный идентификатор палитры.');
  }
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName.length === 0 || trimmedName.length > SCHEME_NAME_MAX_LENGTH) {
    throw new Error(
      `Введите название палитры от 1 до ${SCHEME_NAME_MAX_LENGTH} символов.`,
    );
  }
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    throw new Error('Укажите все восемь цветов палитры.');
  }
  const keys = Object.keys(colors);
  if (
    keys.length !== COLOR_ROLES.length ||
    keys.some((key) => !(COLOR_ROLES as readonly string[]).includes(key))
  ) {
    throw new Error(
      'Укажите ровно восемь цветов: bg1, bg2, bg3, black, obj1, obj2, obj3, white.',
    );
  }
  const normalized = {} as Record<ColorRole, string>;
  for (const role of COLOR_ROLES) {
    const hex = normalizeSchemeColor(colors[role]);
    if (hex === undefined) {
      throw new Error(
        `Цвет ${role}: введите HEX из 3 или 6 цифр, например #AABBCC.`,
      );
    }
    normalized[role] = hex;
  }
  // Equal colors are valid: roles stay independent when their visible colors coincide.
  return { id, name: trimmedName, colors: normalized };
}
