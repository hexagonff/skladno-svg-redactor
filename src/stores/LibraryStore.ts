import { makeAutoObservable, observableRef } from 'mobx';
import type { ColorMap } from '../domain/colors';
import { OBJECT_CATALOG, type CatalogObject } from '../domain/catalog';
import type {
  ImportedAssetId,
  LibraryManifest,
  SchemeId,
} from '../domain/library';
import {
  prepareImportedSvg,
  type InspectedImportedSvg,
} from '../services/svg/importSvg';

/** Built-in artwork stays unchanged; imported objects live only in this store. */
export class LibraryStore {
  manifest: LibraryManifest;
  catalog: readonly CatalogObject[] = OBJECT_CATALOG;
  private nextImport = 1;

  constructor(manifest: LibraryManifest) {
    this.manifest = manifest;
    makeAutoObservable(
      this,
      { manifest: observableRef, catalog: observableRef },
      { autoBind: true },
    );
  }

  importObject(
    name: string,
    inspected: InspectedImportedSvg,
    colorMap: ColorMap,
    sourceScheme: SchemeId,
  ): ImportedAssetId {
    const label = name.trim();
    if (!label || label.length > 80)
      throw new Error('Название должно содержать от 1 до 80 символов.');
    const prepared = prepareImportedSvg(inspected, colorMap);
    let id: ImportedAssetId = `custom-${this.nextImport}`;
    while (this.manifest.assets.some((asset) => asset.id === id)) {
      this.nextImport += 1;
      id = `custom-${this.nextImport}`;
    }
    this.manifest = {
      ...this.manifest,
      assets: [
        ...this.manifest.assets,
        {
          id,
          size: 'L',
          kind: 'object',
          sourceScheme,
          width: inspected.width,
          height: inspected.height,
          viewBox: inspected.viewBox,
          ...prepared,
        },
      ],
    };
    this.catalog = [{ id, name: label }, ...this.catalog];
    this.nextImport += 1;
    return id;
  }
}
