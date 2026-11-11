import { makeAutoObservable, observableRef } from 'mobx';
import type { ColorRole } from '../domain/colors';
import type { ColorScheme, CustomSchemeId, SchemeId } from '../domain/library';
import { createCustomScheme } from '../domain/schemes';

/** Built-in palettes are copied; additions live only in this browser session. */
export class SchemeStore {
  schemes: readonly ColorScheme[];
  private nextSchemeNumber = 1;

  constructor(initialSchemes: readonly ColorScheme[]) {
    const ids = new Set<SchemeId>();
    this.schemes = initialSchemes.map((scheme) => {
      if (ids.has(scheme.id)) {
        throw new Error(`Duplicate color scheme: ${scheme.id}`);
      }
      ids.add(scheme.id);
      return { ...scheme, colors: { ...scheme.colors } };
    });
    makeAutoObservable(this, { schemes: observableRef }, { autoBind: true });
  }

  findScheme(id: SchemeId): ColorScheme | undefined {
    return this.schemes.find((scheme) => scheme.id === id);
  }

  requireScheme(id: SchemeId): ColorScheme {
    const scheme = this.findScheme(id);
    if (scheme === undefined) throw new Error(`Unknown color scheme: ${id}`);
    return scheme;
  }

  addScheme(
    name: string,
    colors: Readonly<Record<ColorRole, string>>,
  ): CustomSchemeId {
    let nextNumber = this.nextSchemeNumber;
    let id: CustomSchemeId = `custom-scheme-${nextNumber}`;
    while (this.findScheme(id) !== undefined) {
      nextNumber += 1;
      id = `custom-scheme-${nextNumber}`;
    }
    const scheme = createCustomScheme(id, name, colors);
    this.schemes = [...this.schemes, scheme];
    this.nextSchemeNumber = nextNumber + 1;
    return id;
  }
}
