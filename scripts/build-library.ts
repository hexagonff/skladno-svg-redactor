import { readdir, readFile, writeFile } from 'node:fs/promises';
import type {
  ColorScheme,
  LibraryTags,
  SchemeColorMaps,
} from '../src/domain/library';
import { ASSET_IDS } from '../src/domain/library';
import { buildLibrary } from '../src/services/svg/buildLibrary';

const assetsDirectory = new URL('../src/assets/', import.meta.url);
const libraryDirectory = new URL('library/', assetsDirectory);

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(
    await readFile(new URL(filename, assetsDirectory), 'utf8'),
  ) as T;
}

const [schemes, colorMaps, tags, filenames] = await Promise.all([
  readJson<ColorScheme[]>('schemes.json'),
  readJson<SchemeColorMaps>('color-map.json'),
  readJson<LibraryTags>('tags.json'),
  readdir(libraryDirectory),
]);
for (const id of ASSET_IDS) {
  const entry = tags[id];
  if (
    !entry ||
    ![entry.tags, entry.synonyms?.ru, entry.synonyms?.en].every(
      (values) =>
        Array.isArray(values) &&
        values.every((value) => typeof value === 'string'),
    )
  )
    throw new Error(`Invalid tags entry: ${id}`);
}
const sources = await Promise.all(
  filenames
    .filter((name) => name.endsWith('.svg'))
    .map(async (filename) => ({
      filename,
      svg: await readFile(new URL(filename, libraryDirectory), 'utf8'),
    })),
);
const { manifest, warnings } = buildLibrary(sources, schemes, colorMaps);
// Keep source copies intact. IDs are prefixed per scene instance by prefixSvgIds.
const output = new URL('manifest.json', libraryDirectory);
await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
console.log(
  `Built ${manifest.assets.length} independent SVG assets (20 objects, 6 canvases).`,
);
console.log('Output: src/assets/library/manifest.json');
console.log(`Warnings: ${warnings.length}`);
