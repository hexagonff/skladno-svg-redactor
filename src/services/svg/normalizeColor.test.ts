import { describe, expect, it } from 'vitest';
import { normalizeColor } from './normalizeColor';

describe('normalizeColor', () => {
  it.each([
    ['  White ', '#FFFFFF'],
    ['BLACK', '#000000'],
    ['#abc', '#AABBCC'],
    ['#aAbBcC', '#AABBCC'],
    ['#abcf', '#AABBCC'],
    ['#aabbccFF', '#AABBCC'],
    ['rgb(170, 187, 204)', '#AABBCC'],
    ['rgb(170 187 204)', '#AABBCC'],
    ['RGB(100%, 0%, 50%)', '#FF0080'],
    ['rgb(100% 0% 50% / 100%)', '#FF0080'],
    ['rgba(170, 187, 204, 1)', '#AABBCC'],
    ['rgba(170 187 204 / 1)', '#AABBCC'],
  ])('normalizes %s to %s', (source, expected) => {
    expect(normalizeColor(source)).toBe(expected);
  });

  it.each([
    'rgba(255, 255, 255, 0.5)',
    'rgb(255 255 255 / 50%)',
    '#FFF8',
    '#FFFFFFFE',
    'transparent',
    'none',
    'currentColor',
    'url(#gradient)',
    'rgb(1, 2)',
    'rgb(1 2 3 /)',
    'rgb(1,,3)',
    '#GGGGGG',
    'white noise',
    '__proto__',
    'constructor',
  ])(
    'does not collapse translucent, unsupported or invalid paint %s to RGB',
    (source) => {
      expect(normalizeColor(source)).toBeUndefined();
    },
  );
});
