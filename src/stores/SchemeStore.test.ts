import { autorun } from 'mobx';
import { describe, expect, it } from 'vitest';
import builtinSchemes from '../assets/schemes.json';
import type { ColorRole } from '../domain/colors';
import type { ColorScheme } from '../domain/library';
import { createCustomScheme } from '../domain/schemes';
import { SchemeStore } from './SchemeStore';

const builtins = builtinSchemes as ColorScheme[];

function colors(): Record<ColorRole, string> {
  return { ...builtins[0].colors };
}

describe('session palette registry', () => {
  it('owns copies of the initial palette list and color maps', () => {
    const initial = builtins.map((scheme) => ({
      ...scheme,
      colors: { ...scheme.colors },
    }));
    const store = new SchemeStore(initial);
    expect(store.schemes).toEqual(builtins);
    expect(store.schemes).not.toBe(initial);
    expect(store.schemes[0]).not.toBe(initial[0]);
    expect(store.schemes[0].colors).not.toBe(initial[0].colors);
    initial[0].name = 'Outside change';
    initial[0].colors.bg1 = '#000000';
    initial.pop();
    expect(store.schemes).toEqual(builtins);
    expect(store.requireScheme('purple').canvas).toBe('canvas1');
  });

  it('registers normalized palettes reactively using bound actions and distinct IDs', () => {
    const store = new SchemeStore(builtins);
    const observed: number[] = [];
    const dispose = autorun(() => observed.push(store.schemes.length));
    const input = { ...colors(), bg1: 'abc', obj1: '#123456', white: 'FFFFFF' };
    const { addScheme } = store;
    const first = addScheme('  My palette  ', input);
    const second = addScheme('My palette', input);
    dispose();
    expect(observed).toEqual([3, 4, 5]);
    expect(first).toBe('custom-scheme-1');
    expect(second).toBe('custom-scheme-2');
    expect(store.schemes.slice(0, 3)).toEqual(builtins);
    expect(store.schemes.slice(3).map((scheme) => scheme.id)).toEqual([
      first,
      second,
    ]);
    expect(store.requireScheme(first)).toEqual({
      id: first,
      name: 'My palette',
      colors: { ...colors(), bg1: '#AABBCC', obj1: '#123456' },
    });
    input.bg1 = '#000000';
    expect(store.requireScheme(first).colors.bg1).toBe('#AABBCC');
    expect(store.requireScheme(first).colors).not.toBe(
      store.requireScheme(second).colors,
    );
  });

  it('keeps additions in one instance and starts fresh with the built-in base', () => {
    const first = new SchemeStore(builtins);
    const id = first.addScheme('Temporary', colors());
    const fresh = new SchemeStore(builtins);
    expect(first.findScheme(id)).toBeDefined();
    expect(fresh.findScheme(id)).toBeUndefined();
    expect(fresh.schemes).toEqual(builtins);
    expect(builtins).toHaveLength(3);
    expect(fresh.addScheme('Another session', colors())).toBe(
      'custom-scheme-1',
    );
  });

  it('fails atomically without consuming IDs or notifying observers', () => {
    const store = new SchemeStore(builtins);
    const initial = store.schemes;
    const observed: number[] = [];
    const dispose = autorun(() => observed.push(store.schemes.length));
    expect(() => store.addScheme('  ', colors())).toThrow();
    expect(() =>
      store.addScheme('Bad color', { ...colors(), obj3: '#GGGGGG' }),
    ).toThrow();
    const partial: Partial<Record<ColorRole, string>> = colors();
    delete partial.white;
    expect(() =>
      store.addScheme('Missing role', partial as Record<ColorRole, string>),
    ).toThrow();
    expect(store.schemes).toBe(initial);
    expect(observed).toEqual([3]);
    expect(store.addScheme('Valid', colors())).toBe('custom-scheme-1');
    dispose();
  });

  it('avoids IDs from supplied palettes and rejects ambiguous initial IDs', () => {
    const one = createCustomScheme('custom-scheme-1', 'One', colors());
    const three = createCustomScheme('custom-scheme-3', 'Three', colors());
    const initial = [...builtins, one, three];
    const store = new SchemeStore(initial);
    expect(store.addScheme('Two', colors())).toBe('custom-scheme-2');
    expect(store.addScheme('Four', colors())).toBe('custom-scheme-4');
    expect(initial).toHaveLength(5);
    expect(() => new SchemeStore([...builtins, builtins[0]])).toThrow(
      /Duplicate color scheme/,
    );
    expect(() => new SchemeStore([...builtins, one, one])).toThrow(
      /Duplicate color scheme/,
    );
  });

  it('allows equal role colors without merging the role keys', () => {
    const store = new SchemeStore(builtins);
    const id = store.addScheme('Equal', {
      ...colors(),
      bg1: '#123',
      obj1: '#112233',
    });
    expect(store.requireScheme(id).colors.bg1).toBe('#112233');
    expect(store.requireScheme(id).colors.obj1).toBe('#112233');
    expect(Object.keys(store.requireScheme(id).colors)).toHaveLength(8);
  });

  it('reports missing palettes without changing the registry', () => {
    const store = new SchemeStore(builtins);
    const initial = store.schemes;
    expect(store.findScheme('custom-scheme-missing')).toBeUndefined();
    expect(() => store.requireScheme('custom-scheme-missing')).toThrow(
      /Unknown color scheme/,
    );
    expect(store.schemes).toBe(initial);
  });
});
