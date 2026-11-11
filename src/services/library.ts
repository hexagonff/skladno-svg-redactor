import manifestUrl from '../assets/library/manifest.json?url';
import schemes from '../assets/schemes.json';
import type { ColorScheme, LibraryManifest } from '../domain/library';

export const colorSchemes = schemes as ColorScheme[];
export { OBJECT_CATALOG } from '../domain/catalog';

// Keep the large SVG catalogue in a separate static asset, outside the JS bundle.
export async function loadLibraryManifest(
  signal?: AbortSignal,
): Promise<LibraryManifest> {
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) throw new Error('Не удалось загрузить библиотеку SVG.');
  const data: unknown = await response.json();
  if (
    typeof data !== 'object' ||
    data === null ||
    !('version' in data) ||
    data.version !== 1 ||
    !('assets' in data) ||
    !Array.isArray(data.assets)
  ) {
    throw new Error('Неверный формат библиотеки SVG.');
  }
  // Individual assets are checked by build:library and the SVG renderer.
  return data as LibraryManifest;
}
