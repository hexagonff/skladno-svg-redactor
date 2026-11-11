import { autorun } from 'mobx';
import { describe, expect, it } from 'vitest';
import { OBJECT_CATALOG } from '../domain/catalog';
import type { LibraryManifest } from '../domain/library';
import { inspectImportedSvg } from '../services/svg/importSvg';
import { LibraryStore } from './LibraryStore';
import { SceneStore } from './SceneStore';

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 -20 24 12"><path fill="red" d="M10-20h24v12H10z"/></svg>';

function makeLibrary() {
  const original: LibraryManifest = { version: 1, assets: [] };
  return { original, library: new LibraryStore(original) };
}

describe('session SVG library', () => {
  it('registers independent named assets reactively without touching built-ins', () => {
    const { original, library } = makeLibrary();
    const inspected = inspectImportedSvg(source);
    const updates: number[] = [];
    const dispose = autorun(() => updates.push(library.catalog.length));
    const first = library.importObject(
      '  Мой SVG  ',
      inspected,
      { '#FF0000': 'obj2', '#000000': 'black' },
      'teal',
    );
    const second = library.importObject(
      'Мой SVG',
      inspected,
      { '#FF0000': 'bg1', '#000000': 'black' },
      'purple',
    );
    dispose();
    expect(first).not.toBe(second);
    expect(original.assets).toEqual([]);
    expect(OBJECT_CATALOG).toHaveLength(10);
    expect(library.catalog.slice(0, 2)).toEqual([
      { id: second, name: 'Мой SVG' },
      { id: first, name: 'Мой SVG' },
    ]);
    expect(updates).toEqual([10, 11, 12]);
    expect(library.manifest.assets).toHaveLength(2);
    expect(library.manifest.assets[0]).toMatchObject({
      id: first,
      size: 'L',
      kind: 'object',
      sourceScheme: 'teal',
      width: 24,
      height: 12,
      viewBox: '10 -20 24 12',
    });
    expect(library.manifest.assets[0].svg).toContain('var(--obj2)');
    expect(library.manifest.assets[0].backgroundSvg).not.toContain(
      'var(--obj2)',
    );
    expect(new LibraryStore(original).catalog).toHaveLength(10);
    expect(new LibraryStore(original).manifest.assets).toEqual([]);
  });

  it('rejects invalid labels and missing mappings without partial registration', () => {
    const { original, library } = makeLibrary();
    const inspected = inspectImportedSvg(source);
    for (const name of ['', '  ', 'x'.repeat(81)])
      expect(() =>
        library.importObject(name, inspected, {}, 'purple'),
      ).toThrow();
    expect(() =>
      library.importObject('Good', inspected, {}, 'purple'),
    ).toThrow();
    expect(library.manifest).toBe(original);
    expect(library.catalog).toBe(OBJECT_CATALOG);
  });

  it('adds only registered objects and keeps the original source dimensions', () => {
    const { library } = makeLibrary();
    const store = new SceneStore(undefined, () => library.manifest);
    expect(() => store.addItem('custom-missing')).toThrow();
    expect(store.scene.items).toEqual([]);
    const id = library.importObject(
      'Icon',
      inspectImportedSvg(source),
      { '#FF0000': 'obj1', '#000000': 'black' },
      'purple',
    );
    store.addItem(id);
    expect(store.selectedItem).toMatchObject({
      assetId: id,
      size: 'L',
      x: 500,
      y: 500,
    });
    expect(store.selectedItem?.scale).toBeCloseTo(1);
    const before = store.scene;
    expect(() => store.setSelectedSize('S')).toThrow();
    expect(store.scene).toBe(before);
    store.addItem(id);
    expect(store.scene.items.map((item) => item.id)).toEqual([
      'item-1',
      'item-2',
    ]);
    store.setSelectedRole('bg');
    store.setSelectedColor('bg1', 'bg3');
    store.moveItem('item-2', { x: 12, y: 34 });
    store.setSelectedLayer(1);
    expect(store.selectedItem).toMatchObject({
      assetId: id,
      x: 12,
      y: 34,
      role: 'bg',
      colorOverrides: { bg: { bg1: 'bg3' } },
    });
    store.deleteSelectedItem();
    expect(library.manifest.assets).toHaveLength(1);
  });

  it('requires a library for custom initial scenes and preserves the native size of very tall objects', () => {
    expect(() => new SceneStore().addItem('custom-1')).toThrow(
      /registered library/,
    );
    const { library } = makeLibrary();
    const id = library.importObject(
      'Tall',
      inspectImportedSvg(
        '<svg width="10" height="1000"><rect width="10" height="1000" fill="white"/></svg>',
      ),
      { '#FFFFFF': 'white', '#000000': 'black' },
      'orange',
    );
    const store = new SceneStore(undefined, () => library.manifest);
    store.addItem(id);
    expect(store.selectedItem?.scale).toBeCloseTo(1);
    expect(() => new SceneStore(store.scene)).toThrow(/registered library/);
  });
});
