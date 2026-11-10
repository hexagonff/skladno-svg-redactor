import { describe, expect, it } from 'vitest';
import { COLOR_ROLES, type ColorRole } from './colors';
import { isCustomSchemeId, type CustomSchemeId } from './library';
import {
  createCustomScheme,
  normalizeSchemeColor,
  SCHEME_NAME_MAX_LENGTH,
} from './schemes';

function colors(): Record<ColorRole, string> {
  return {
    bg1: '#112233',
    bg2: '#445566',
    bg3: '#778899',
    black: '#101010',
    obj1: '#AABBCC',
    obj2: '#DDEEFF',
    obj3: '#FFAA55',
    white: '#FAFAFA',
  };
}

describe('session color schemes', () => {
  it.each([
    ['#abc', '#AABBCC'],
    ['AbC', '#AABBCC'],
    ['  #a1b2c3  ', '#A1B2C3'],
    ['123456', '#123456'],
    ['#000', '#000000'],
    ['fff', '#FFFFFF'],
  ])('normalizes opaque HEX %s to %s', (input, expected) => {
    expect(normalizeSchemeColor(input)).toBe(expected);
  });

  it.each([
    '',
    '#',
    '12345',
    '#1234',
    '#12345678',
    '1234567',
    '#GGGGGG',
    '##112233',
    'rgb(1, 2, 3)',
    'white',
    'transparent',
    'var(--bg1)',
    '#12 3456',
    '#123\n456',
  ])('rejects unsupported color %j', (input) => {
    expect(normalizeSchemeColor(input)).toBeUndefined();
  });

  it('creates independent normalized role colors without linking the chosen canvas', () => {
    const input = Object.freeze({ ...colors(), bg1: ' abc ', white: '#fff' });
    const scheme = createCustomScheme(
      'custom-scheme-1',
      '  Моя палитра  ',
      input,
    );
    expect(scheme).toEqual({
      id: 'custom-scheme-1',
      name: 'Моя палитра',
      colors: {
        ...colors(),
        bg1: '#AABBCC',
        white: '#FFFFFF',
      },
    });
    expect(scheme).not.toHaveProperty('canvas');
    expect(scheme.colors).not.toBe(input);
    expect(input.bg1).toBe(' abc ');
    scheme.colors.obj1 = '#111111';
    expect(input.obj1).toBe('#AABBCC');
  });

  it('allows identical visible colors in independent palette roles', () => {
    const input = Object.fromEntries(
      COLOR_ROLES.map((role) => [role, '#abc']),
    ) as Record<ColorRole, string>;
    const scheme = createCustomScheme('custom-scheme-2', 'Один цвет', input);
    expect(Object.keys(scheme.colors)).toEqual([...COLOR_ROLES]);
    expect(Object.values(scheme.colors)).toEqual(
      COLOR_ROLES.map(() => '#AABBCC'),
    );
  });

  it.each(['', '  ', 'a'.repeat(SCHEME_NAME_MAX_LENGTH + 1)])(
    'rejects empty or overlong name %j',
    (name) => {
      expect(() =>
        createCustomScheme('custom-scheme-1', name, colors()),
      ).toThrow(/название.*1.*80/);
    },
  );

  it('accepts the name length boundary after trimming', () => {
    const name = 'я'.repeat(SCHEME_NAME_MAX_LENGTH);
    expect(
      createCustomScheme('custom-scheme-1', ` ${name} `, colors()).name,
    ).toBe(name);
  });

  it('requires exactly the eight known roles and reports an invalid role color', () => {
    const { white: _white, ...missing } = colors();
    void _white;
    for (const invalid of [
      missing,
      { ...colors(), extra: '#123456' },
      null,
      [],
      { ...colors(), obj2: undefined },
    ]) {
      expect(() =>
        createCustomScheme(
          'custom-scheme-1',
          'Палитра',
          invalid as Record<ColorRole, string>,
        ),
      ).toThrow();
    }
    expect(() =>
      createCustomScheme('custom-scheme-1', 'Палитра', {
        ...colors(),
        obj2: 'bad-color',
      }),
    ).toThrow(/obj2.*HEX/);
  });

  it.each([
    'purple',
    '',
    'custom-scheme-',
    'custom-scheme-a--b',
    'custom-scheme-../1',
    'custom-scheme-1<script>',
    'custom-scheme-' + 'a'.repeat(128),
  ])('rejects unsafe or unreserved custom identifier %j', (id) => {
    expect(isCustomSchemeId(id)).toBe(false);
    expect(() =>
      createCustomScheme(id as CustomSchemeId, 'Палитра', colors()),
    ).toThrow(/идентификатор/);
  });

  it('accepts safe session IDs regardless of display name', () => {
    for (const id of ['custom-scheme-1', 'custom-scheme-aB09-session']) {
      expect(isCustomSchemeId(id)).toBe(true);
    }
    expect(isCustomSchemeId(undefined)).toBe(false);
    expect(isCustomSchemeId(1)).toBe(false);
    const first = createCustomScheme(
      'custom-scheme-1',
      'Одинаковое имя',
      colors(),
    );
    const second = createCustomScheme('custom-scheme-2', first.name, colors());
    expect(second.id).not.toBe(first.id);
  });
});
