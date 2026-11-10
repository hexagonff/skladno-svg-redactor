import { readFileSync, readdirSync } from 'node:fs';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseRoleToken } from '../../domain/colors';
import type {
  AssetId,
  AssetSize,
  AssetSource,
  ColorScheme,
  LibraryAsset,
  SchemeColorMaps,
} from '../../domain/library';
import { buildLibrary } from './buildLibrary';
import { parseSvg, serializeSvg } from './svgDocument';

const libraryDirectory = new URL('../../assets/library/', import.meta.url);
const sources: AssetSource[] = readdirSync(libraryDirectory)
  .filter((filename) => filename.endsWith('.svg'))
  .sort()
  .map((filename) => ({
    filename,
    svg: readFileSync(new URL(filename, libraryDirectory), 'utf8'),
  }));
const schemes = JSON.parse(
  readFileSync(new URL('../../assets/schemes.json', import.meta.url), 'utf8'),
) as ColorScheme[];
const colorMaps = JSON.parse(
  readFileSync(new URL('../../assets/color-map.json', import.meta.url), 'utf8'),
) as SchemeColorMaps;
const baseline = buildLibrary(sources, schemes, colorMaps);

function assetFor(
  id: AssetId,
  size: AssetSize,
  assets: readonly LibraryAsset[] = baseline.manifest.assets,
): LibraryAsset {
  const asset = assets.find((entry) => entry.id === id && entry.size === size);
  if (!asset) throw new Error(`Missing test asset: ${id}__${size}`);
  return asset;
}

function sourceFor(filename: string): AssetSource {
  const source = sources.find((entry) => entry.filename === filename);
  if (!source) throw new Error(`Missing test source: ${filename}`);
  return source;
}

function changeSource(
  filename: string,
  change: (svg: string) => string,
): AssetSource[] {
  return sources.map((source) =>
    source.filename === filename
      ? { ...source, svg: change(source.svg) }
      : source,
  );
}

function paths(svg: string): Element[] {
  return Array.from(parseSvg(svg).getElementsByTagName('path'));
}

function visiblePaints(svg: string): string[] {
  const paints: string[] = [];
  const visit = (element: Element): void => {
    if (
      ['defs', 'clippath'].includes(
        (element.localName ?? element.tagName).toLowerCase(),
      )
    )
      return;
    for (const name of ['fill', 'stroke']) {
      const paint = element.getAttribute(name);
      if (paint !== null) paints.push(paint);
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(parseSvg(svg).documentElement!);
  return paints;
}

function definitions(svg: string): string[] {
  const document = parseSvg(svg);
  return ['defs', 'clipPath'].flatMap((name) =>
    Array.from(document.getElementsByTagName(name)).map(serializeSvg),
  );
}

describe('buildLibrary with the copied Figma assets', () => {
  it('builds 26 independent entries forming 13 complete L/S pairs', () => {
    const assets = baseline.manifest.assets;
    const ids = new Set(assets.map((asset) => asset.id));

    expect(sources).toHaveLength(26);
    expect(baseline.manifest.version).toBe(1);
    expect(assets).toHaveLength(26);
    expect(ids.size).toBe(13);
    for (const id of ids) {
      expect(
        assets.filter((asset) => asset.id === id).map(({ size }) => size),
      ).toEqual(['L', 'S']);
    }
    expect(assets.filter((asset) => asset.kind === 'object')).toHaveLength(20);
    expect(assets.filter((asset) => asset.kind === 'canvas')).toHaveLength(6);
  });

  it('uses purple for every object and the matching source scheme for each canvas', () => {
    for (const asset of baseline.manifest.assets) {
      if (asset.kind === 'object') expect(asset.sourceScheme).toBe('purple');
    }
    for (const size of ['L', 'S'] as const) {
      for (const [id, scheme] of [
        ['canvas1', 'purple'],
        ['canvas2', 'orange'],
        ['canvas3', 'teal'],
      ] as const) {
        const asset = assetFor(id, size);
        const rect = parseSvg(asset.svg).getElementsByTagName('rect')[0];
        expect(asset.sourceScheme).toBe(scheme);
        expect(rect?.getAttribute('fill')).toBe('var(--bg1)');
        expect(asset.backgroundSvg).toBeUndefined();
      }
      const teal = assetFor('canvas3', size);
      expect(visiblePaints(teal.svg)).toContain('var(--bg2)');
      expect(visiblePaints(teal.svg)).not.toContain('var(--obj2)');
    }
  });

  it('resolves the same hex by its source scheme instead of a global color table', () => {
    const probe = '<path id="scheme-probe" fill="#80dada" d="M0 0h1v1z"/>';
    const altered = sources.map((source) =>
      ['canvas2__L.svg', 'canvas3__L.svg', 'vase__L.svg'].includes(
        source.filename,
      )
        ? { ...source, svg: source.svg.replace('</svg>', `${probe}</svg>`) }
        : source,
    );
    const result = buildLibrary(altered, schemes, colorMaps);
    const fill = (id: AssetId): string | null | undefined =>
      paths(assetFor(id, 'L', result.manifest.assets).svg)
        .find((path) => path.getAttribute('id') === 'scheme-probe')
        ?.getAttribute('fill');

    expect(fill('canvas2')).toBe('var(--obj2)');
    expect(fill('canvas3')).toBe('var(--bg2)');
    expect(fill('vase')).toBe('#80dada');
    expect(result.warnings).toContain(
      'vase__L.svg: Unmapped SVG paint: #80DADA',
    );
  });

  it.each([
    { id: 'phone', size: 'L', width: 797, height: 462, count: 155 },
    { id: 'phone', size: 'S', width: 399, height: 231, count: 96 },
    { id: 'book', size: 'L', width: 1446, height: 977, count: 53 },
    { id: 'book', size: 'S', width: 723, height: 489, count: 51 },
  ] as const)(
    'preserves the independent $id/$size geometry',
    ({ id, size, width, height, count }) => {
      const source = sourceFor(`${id}__${size}.svg`);
      const asset = assetFor(id, size);

      expect(asset.width).toBe(width);
      expect(asset.height).toBe(height);
      expect(asset.viewBox).toBe(`0 0 ${width} ${height}`);
      expect(paths(asset.svg)).toHaveLength(count);
      expect(paths(asset.svg).map((path) => path.getAttribute('d'))).toEqual(
        paths(source.svg).map((path) => path.getAttribute('d')),
      );
    },
  );

  it('retains different L/S role distributions instead of deriving one size from the other', () => {
    expect(visiblePaints(assetFor('book', 'L').svg)).toContain('var(--obj3)');
    expect(visiblePaints(assetFor('book', 'S').svg)).not.toContain(
      'var(--obj3)',
    );
    expect(
      visiblePaints(assetFor('phone', 'L').svg).filter(
        (paint) => paint === 'var(--bg1)',
      ),
    ).toHaveLength(50);
    expect(
      visiblePaints(assetFor('phone', 'S').svg).filter(
        (paint) => paint === 'var(--bg1)',
      ),
    ).toHaveLength(1);
  });

  it('keeps clip paths, definitions, and their original paints intact', () => {
    let definitionCount = 0;
    for (const asset of baseline.manifest.assets) {
      const original = definitions(
        sourceFor(`${asset.id}__${asset.size}.svg`).svg,
      );
      definitionCount += original.length;
      expect(definitions(asset.svg)).toEqual(original);
      if (asset.backgroundSvg !== undefined) {
        expect(definitions(asset.backgroundSvg)).toEqual(original);
      }
    }
    expect(definitionCount).toBeGreaterThan(0);
    const canvas = parseSvg(assetFor('canvas2', 'L').svg);
    const clip = canvas.getElementsByTagName('clipPath')[0];
    expect(clip?.getElementsByTagName('rect')[0]?.getAttribute('fill')).toBe(
      'white',
    );
  });

  it('creates object background variants using only bg1, bg2, and bg3 paints', () => {
    for (const asset of baseline.manifest.assets.filter(
      (entry) => entry.kind === 'object',
    )) {
      expect(asset.backgroundSvg).toBeDefined();
      const roles = visiblePaints(asset.backgroundSvg!)
        .map(parseRoleToken)
        .filter((role) => role !== undefined);
      expect(roles.length).toBeGreaterThan(0);
      expect(roles.every((role) => ['bg1', 'bg2', 'bg3'].includes(role))).toBe(
        true,
      );
    }
  });

  it('reports the vase TODO and both cross-scheme role ambiguities', () => {
    expect(baseline.warnings).toHaveLength(3);
    expect(baseline.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/#80DADA:.*orange\.obj2.*teal\.bg2/),
        expect.stringMatching(/#BEEBEB:.*orange\.obj3.*teal\.bg1/),
        expect.stringMatching(/vase:.*bg2.*not confirmed.*TODO/),
      ]),
    );
  });

  it('warns about an unknown normalized paint while preserving that source paint', () => {
    const altered = changeSource('vase__L.svg', (svg) =>
      svg.replace(
        '</svg>',
        '<path id="unknown-paint" fill="rgb(18, 52, 86)" d="M0 0h1v1z"/></svg>',
      ),
    );
    const result = buildLibrary(altered, schemes, colorMaps);
    const unknown = paths(
      assetFor('vase', 'L', result.manifest.assets).svg,
    ).find((path) => path.getAttribute('id') === 'unknown-paint');

    expect(result.warnings).toContain(
      'vase__L.svg: Unmapped SVG paint: #123456',
    );
    expect(unknown?.getAttribute('fill')).toBe('rgb(18, 52, 86)');
  });
});

describe('buildLibrary input validation', () => {
  it('rejects a missing S asset', () => {
    const missing = sources.filter(
      (source) => source.filename !== 'vase__S.svg',
    );
    expect(() => buildLibrary(missing, schemes, colorMaps)).toThrow(
      /Missing independent asset: vase__S\.svg/,
    );
  });

  it('rejects duplicate filenames', () => {
    const duplicate = [...sources, { ...sourceFor('book__L.svg') }];
    expect(() => buildLibrary(duplicate, schemes, colorMaps)).toThrow(
      /Duplicate asset: book__L\.svg/,
    );
  });

  it.each(['book-L.svg', 'book__M.svg', 'unknown__L.svg'])(
    'rejects the unexpected name %s',
    (filename) => {
      const unexpected = sources.map((source) =>
        source.filename === 'book__L.svg' ? { ...source, filename } : source,
      );
      expect(() => buildLibrary(unexpected, schemes, colorMaps)).toThrow(
        /Unexpected asset filename/,
      );
    },
  );

  it.each(['0', '-1', '100%', 'NaN'])(
    'rejects the invalid SVG dimension %s',
    (width) => {
      const altered = changeSource('vase__L.svg', (svg) =>
        svg.replace(/width="[^"]+"/, `width="${width}"`),
      );
      expect(() => buildLibrary(altered, schemes, colorMaps)).toThrow(
        /Invalid SVG width/,
      );
    },
  );

  it.each(['0 0 0 100', '0 0 100', '0 0 NaN 100'])(
    'rejects the invalid viewBox %s',
    (viewBox) => {
      const altered = changeSource('vase__L.svg', (svg) =>
        svg.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`),
      );
      expect(() => buildLibrary(altered, schemes, colorMaps)).toThrow(
        /Invalid SVG viewBox/,
      );
    },
  );

  it('rejects a color map that disagrees with the corresponding scheme', () => {
    const inconsistent: SchemeColorMaps = {
      ...colorMaps,
      purple: { ...colorMaps.purple, '#181817': 'white' },
    };
    expect(() => buildLibrary(sources, schemes, inconsistent)).toThrow(
      /Color map disagrees with purple\.black/,
    );
  });
});
