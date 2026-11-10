import { describe, expect, it } from 'vitest';
import type { ColorRole } from './colors';
import {
  assertObjectColorOverrides,
  BACKGROUND_COLOR_ROLES,
  EDITABLE_COLOR_ROLES,
  getEditableColorRoles,
  type ObjectColorOverrides,
} from './objectColors';

describe('object color roles', () => {
  it('allows palette shades in main objects and only background shades in background objects', () => {
    expect(getEditableColorRoles('main')).toEqual([
      'bg1',
      'bg2',
      'bg3',
      'obj1',
      'obj2',
      'obj3',
    ]);
    expect(getEditableColorRoles('bg')).toEqual(['bg1', 'bg2', 'bg3']);
    for (const source of EDITABLE_COLOR_ROLES) {
      for (const target of EDITABLE_COLOR_ROLES) {
        expect(() =>
          assertObjectColorOverrides({ [source]: target }, 'main'),
        ).not.toThrow();
      }
    }
    for (const source of BACKGROUND_COLOR_ROLES) {
      for (const target of BACKGROUND_COLOR_ROLES) {
        expect(() =>
          assertObjectColorOverrides({ [source]: target }, 'bg'),
        ).not.toThrow();
      }
    }
  });

  it('accepts absent or empty overrides without adding defaults', () => {
    expect(() => assertObjectColorOverrides(undefined, 'main')).not.toThrow();
    expect(() => assertObjectColorOverrides({}, 'bg')).not.toThrow();
  });

  it.each(['black', 'white', 'unknown'])(
    'rejects neutral or unknown source and target %s',
    (role) => {
      for (const objectRole of ['main', 'bg'] as const) {
        expect(() =>
          assertObjectColorOverrides({ [role]: 'bg1' }, objectRole),
        ).toThrow(/source/);
        expect(() =>
          assertObjectColorOverrides({ bg1: role as ColorRole }, objectRole),
        ).toThrow(/target/);
      }
    },
  );

  it.each(['obj1', 'obj2', 'obj3'] as const)(
    'rejects object role %s in background overrides',
    (role) => {
      expect(() => assertObjectColorOverrides({ [role]: 'bg1' }, 'bg')).toThrow(
        /source/,
      );
      expect(() => assertObjectColorOverrides({ bg1: role }, 'bg')).toThrow(
        /target/,
      );
    },
  );

  it.each([null, [], 'bg1', 42])(
    'rejects malformed override maps %j',
    (overrides) => {
      expect(() =>
        assertObjectColorOverrides(overrides as ObjectColorOverrides, 'main'),
      ).toThrow(/map/);
    },
  );

  it('rejects an unknown scene role', () => {
    expect(() => getEditableColorRoles('other' as 'main')).toThrow(
      /Unknown scene role/,
    );
  });
});
