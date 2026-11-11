import { describe, expect, it } from 'vitest';
import {
  COLOR_ROLES,
  parseRoleToken,
  roleToken,
  type ColorRole,
} from '../../domain/colors';
import { parseSvg, serializeSvg } from './svgDocument';
import { toBackgroundVariant } from './toBackgroundVariant';

const expectedRoles: Readonly<Record<ColorRole, ColorRole>> = {
  bg1: 'bg1',
  bg2: 'bg2',
  bg3: 'bg3',
  black: 'bg3',
  obj1: 'bg1',
  obj2: 'bg1',
  obj3: 'bg1',
  white: 'bg1',
};

describe('role tokens', () => {
  it.each(COLOR_ROLES)('round trips the %s role', (role) => {
    expect(parseRoleToken(roleToken(role))).toBe(role);
  });

  it('accepts surrounding whitespace and rejects values without a known role', () => {
    expect(parseRoleToken('  var(--bg2) ')).toBe('bg2');
    expect(parseRoleToken('#181817')).toBeUndefined();
    expect(parseRoleToken('var(--unknown)')).toBeUndefined();
    expect(parseRoleToken('var(--obj1, #FFFFFF)')).toBeUndefined();
    expect(parseRoleToken('url(#var(--obj1))')).toBeUndefined();
  });
});

describe('toBackgroundVariant', () => {
  it.each(COLOR_ROLES)('maps %s in both fill and stroke', (role) => {
    const svg = `<svg><path fill="${roleToken(role)}" stroke="${roleToken(role)}" d="M0 0h10v10z"/></svg>`;
    const result = toBackgroundVariant(svg);
    const expected = roleToken(expectedRoles[role]);

    expect(result).toContain(`fill="${expected}"`);
    expect(result).toContain(`stroke="${expected}"`);
  });

  it('converts a composition while retaining background roles and geometry', () => {
    const svg = `<svg width="100" height="200" viewBox="0 0 100 200"><g id="drawing" transform="translate(4 6) scale(2)"><path fill="var(--white)" stroke="var(--black)" d="M1 2L3 4z"/><rect x="5" y="8" width="15" height="25" fill="var(--obj2)"/><circle cx="10" cy="12" r="3" fill="var(--bg2)"/><path d="M0 1" fill="var(--bg3)" stroke="var(--bg1)"/></g></svg>`;
    const expected = svg
      .replace('fill="var(--white)"', 'fill="var(--bg1)"')
      .replace('stroke="var(--black)"', 'stroke="var(--bg3)"')
      .replace('fill="var(--obj2)"', 'fill="var(--bg1)"');

    expect(toBackgroundVariant(svg)).toBe(serializeSvg(parseSvg(expected)));
  });

  it('preserves definition and clip path paints, IDs, and references', () => {
    const svg = `<svg><defs><linearGradient id="paint"><stop stop-color="var(--obj1)"/></linearGradient><g id="shape"><path fill="var(--white)" stroke="var(--black)" d="M0 0"/></g><clipPath id="clip"><rect width="10" height="20" fill="var(--white)"/></clipPath></defs><clipPath id="outer-clip"><path fill="var(--obj3)" d="M0 0h20v20z"/></clipPath><g clip-path="url(#clip)"><path fill="var(--obj1)" stroke="url(#paint)" d="M1 1h5"/></g></svg>`;
    const expected = svg.replace(
      'fill="var(--obj1)" stroke="url(#paint)"',
      'fill="var(--bg1)" stroke="url(#paint)"',
    );

    expect(toBackgroundVariant(svg)).toBe(serializeSvg(parseSvg(expected)));
  });

  it('leaves literal colors, paint servers, and unrelated attributes unchanged', () => {
    const svg = `<svg><path fill="#181817" stroke="white" data-color="var(--obj1)" d="M0 0"/><path fill="none" stroke="url(#paint)" d="M1 1"/><path fill="currentColor" stroke="var(--custom)" d="M2 2"/></svg>`;

    expect(toBackgroundVariant(svg)).toBe(serializeSvg(parseSvg(svg)));
  });

  it('converts inline paint styles without changing other style declarations', () => {
    const svg = `<svg><path style="fill: var(--obj3); stroke: var(--black); opacity: 0.5; color: var(--white)" d="M1 2L3 4"/></svg>`;
    const expected = svg
      .replace('fill: var(--obj3)', 'fill: var(--bg1)')
      .replace('stroke: var(--black)', 'stroke: var(--bg3)');

    expect(toBackgroundVariant(svg)).toBe(serializeSvg(parseSvg(expected)));
  });

  it('is idempotent after the first conversion', () => {
    const paths = COLOR_ROLES.map(
      (role) => `<path fill="${roleToken(role)}" stroke="${roleToken(role)}"/>`,
    ).join('');
    const first = toBackgroundVariant(`<svg>${paths}</svg>`);

    expect(toBackgroundVariant(first)).toBe(first);
  });
});
