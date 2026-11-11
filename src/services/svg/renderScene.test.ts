import { readFileSync } from 'node:fs';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import { COLOR_ROLES, type ColorRole } from '../../domain/colors';
import { createCustomScheme } from '../../domain/schemes';
import type {
  AssetId,
  AssetSize,
  ColorScheme,
  LibraryAsset,
  LibraryManifest,
} from '../../domain/library';
import {
  createSceneItem,
  setSceneItemLayer,
  type Scene,
} from '../../domain/scene';
import { renderAssetSvg, renderScene } from './renderScene';
import { parseSvg, serializeSvg, visitSvgElements } from './svgDocument';

const manifest = JSON.parse(
  readFileSync(
    new URL('../../assets/library/manifest.json', import.meta.url),
    'utf8',
  ),
) as LibraryManifest;
const schemes = JSON.parse(
  readFileSync(new URL('../../assets/schemes.json', import.meta.url), 'utf8'),
) as ColorScheme[];
const purple = schemes.find((scheme) => scheme.id === 'purple')!;
const orange = schemes.find((scheme) => scheme.id === 'orange')!;
const teal = schemes.find((scheme) => scheme.id === 'teal')!;

function assetFor(id: AssetId, size: AssetSize = 'L'): LibraryAsset {
  return manifest.assets.find(
    (asset) => asset.id === id && asset.size === size,
  )!;
}

function elements(svg: string, tag: string): Element[] {
  return Array.from(parseSvg(svg).getElementsByTagName(tag));
}

function visiblePaints(svg: string): string[] {
  const paints: string[] = [];
  const visit = (element: Element): void => {
    if (['defs', 'clipPath'].includes(element.tagName)) return;
    for (const name of ['fill', 'stroke']) {
      const value = element.getAttribute(name);
      if (value !== null && value !== 'none') paints.push(value);
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(parseSvg(svg).documentElement!);
  return paints;
}

function ids(svg: string): string[] {
  const result: string[] = [];
  visitSvgElements(parseSvg(svg).documentElement!, (element) => {
    if (element.hasAttribute('id')) result.push(element.getAttribute('id')!);
  });
  return result;
}

function itemGroup(svg: string, id = 'first'): Element {
  const group = elements(svg, 'g').find(
    (element) => element.getAttribute('data-item-id') === id,
  );
  if (!group) throw new Error(`Missing item group: ${id}`);
  return group;
}

function itemPaints(svg: string, id = 'first'): string[] {
  return visiblePaints(
    serializeSvg(itemGroup(svg, id).getElementsByTagName('svg')[0]),
  );
}

const scene: Scene = {
  width: 1000,
  height: 1000,
  schemeId: 'purple',
  canvasId: 'canvas1',
  canvasSize: 'L',
  items: [
    {
      id: 'first',
      assetId: 'phone',
      size: 'L',
      role: 'main',
      x: 400,
      y: 600,
      scale: 0.5,
      rotation: 15,
    },
  ],
};

const clippedAsset: LibraryAsset = {
  id: 'book',
  size: 'L',
  kind: 'object',
  sourceScheme: 'purple',
  width: 400,
  height: 180,
  viewBox: '-30 20 400 180',
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180" viewBox="-30 20 400 180" fill="var(--obj2)" opacity="0.8">
    <defs>
      <clipPath id="clip"><rect x="-30" y="20" width="400" height="180" fill="white"/></clipPath>
      <linearGradient id="gradient"><stop offset="0" stop-color="#123456"/></linearGradient>
    </defs>
    <g clip-path="url(#clip)" fill-rule="evenodd">
      <path id="shape" d="M-30 20h400v180z" stroke="var(--black)" stroke-width="2"/>
      <rect width="5" height="6" fill="url(#gradient)" style="stroke: var(--obj1); fill: var(--bg2) !important"/>
    </g>
    <use href="#shape"/>
  </svg>`,
};

describe('renderAssetSvg', () => {
  it.each(manifest.assets)(
    'materializes all colors and keeps the paths of $id__$size in every scheme',
    (asset) => {
      const originalPaths = elements(asset.svg, 'path').map((path) =>
        path.getAttribute('d'),
      );
      for (const scheme of schemes) {
        const svg = renderAssetSvg(
          asset,
          scheme,
          `preview:${asset.id}/${asset.size}`,
        );
        expect(svg).not.toMatch(/var\s*\(/);
        expect(
          visiblePaints(svg).every((paint) =>
            Object.values(scheme.colors).includes(paint),
          ),
        ).toBe(true);
        expect(
          elements(svg, 'path').map((path) => path.getAttribute('d')),
        ).toEqual(originalPaths);
        expect(parseSvg(svg).documentElement!.namespaceURI).toBe(
          'http://www.w3.org/2000/svg',
        );
      }
    },
  );

  it('resolves shared source hex values through their source roles, not a global map', () => {
    const canvas = renderAssetSvg(
      assetFor('canvas3'),
      orange,
      'teal-to-orange',
    );
    expect(visiblePaints(canvas)).toContain(orange.colors.bg1);
    expect(visiblePaints(canvas)).toContain(orange.colors.bg2);
    expect(visiblePaints(canvas)).not.toContain(orange.colors.obj2);
    expect(visiblePaints(canvas)).not.toContain(orange.colors.obj3);
    const book = renderAssetSvg(assetFor('book'), teal, 'purple-to-teal');
    expect(visiblePaints(book)).toContain(teal.colors.obj3);
    expect(visiblePaints(book)).not.toContain(purple.colors.obj3);
  });

  it.each(schemes)(
    'uses only background roles for all object variants in $id',
    (scheme) => {
      for (const asset of manifest.assets.filter(
        (entry) => entry.kind === 'object',
      )) {
        const svg = renderAssetSvg(
          asset,
          scheme,
          `bg-${asset.id}-${asset.size}`,
          'bg',
        );
        const allowed = [
          scheme.colors.bg1,
          scheme.colors.bg2,
          scheme.colors.bg3,
        ];
        expect(
          visiblePaints(svg).every((paint) => allowed.includes(paint)),
        ).toBe(true);
      }
    },
  );

  it('keeps clip/definition paints and geometry, root inheritance and inline attributes', () => {
    const svg = renderAssetSvg(clippedAsset, orange, 'definition-preview');
    const root = parseSvg(svg).documentElement!;
    expect(root.getAttribute('viewBox')).toBe('-30 20 400 180');
    expect(root.getAttribute('width')).toBe('400');
    expect(root.getAttribute('height')).toBe('180');
    expect(root.getAttribute('opacity')).toBe('0.8');
    expect(root.getAttribute('fill')).toBe(orange.colors.obj2);
    const clipRect = elements(svg, 'clipPath')[0].getElementsByTagName(
      'rect',
    )[0];
    expect(clipRect.getAttribute('fill')).toBe('white');
    expect(clipRect.getAttribute('x')).toBe('-30');
    expect(elements(svg, 'stop')[0].getAttribute('stop-color')).toBe('#123456');
    const path = elements(svg, 'path')[0];
    expect(path.getAttribute('d')).toBe('M-30 20h400v180z');
    expect(path.getAttribute('stroke')).toBe(orange.colors.black);
    expect(path.getAttribute('stroke-width')).toBe('2');
    expect(elements(svg, 'rect')[1].getAttribute('style')).toBe(
      `stroke: ${orange.colors.obj1}; fill: ${orange.colors.bg2} !important`,
    );
    expect(elements(svg, 'rect')[1].getAttribute('fill')).toBe(
      `url(#${elements(svg, 'linearGradient')[0].getAttribute('id')})`,
    );
  });

  it('preserves decorative white and never recolors white clip geometry', () => {
    const scheme = {
      ...orange,
      colors: { ...orange.colors, white: '#F0F0F0' },
    };
    const canvas = renderAssetSvg(assetFor('canvas2'), scheme, 'orange-defs');
    expect(
      elements(canvas, 'clipPath')[0]
        .getElementsByTagName('rect')[0]
        .getAttribute('fill'),
    ).toBe('white');
    const purpleCanvas = renderAssetSvg(
      assetFor('canvas1'),
      scheme,
      'decorative-white',
    );
    expect(visiblePaints(purpleCanvas)).toContain('#F0F0F0');
  });

  it('reports missing variants, invalid colors, tokens and forbidden output explicitly', () => {
    expect(() =>
      renderAssetSvg(
        { ...clippedAsset, backgroundSvg: undefined },
        purple,
        'x',
        'bg',
      ),
    ).toThrow(/Missing background variant/);
    expect(() =>
      renderAssetSvg(
        clippedAsset,
        { ...purple, colors: { ...purple.colors, obj1: 'none' } },
        'x',
      ),
    ).toThrow(/Invalid color/);
    expect(() =>
      renderAssetSvg(
        {
          ...clippedAsset,
          svg: clippedAsset.svg.replace('var(--obj2)', 'var(--unknown)'),
        },
        purple,
        'x',
      ),
    ).toThrow(/Unresolved SVG paint token/);
    expect(() =>
      renderAssetSvg(
        {
          ...clippedAsset,
          svg: '<svg><defs><path fill="var(--white)"/></defs></svg>',
        },
        purple,
        'x',
      ),
    ).toThrow(/Unresolved SVG token/);
    expect(() => renderAssetSvg(clippedAsset, purple, '')).toThrow(/namespace/);
    for (const tag of ['image', 'foreignObject', 'style']) {
      expect(() =>
        renderAssetSvg(
          { ...clippedAsset, svg: `<svg><${tag}/></svg>` },
          purple,
          'x',
        ),
      ).toThrow(/must not contain/);
    }
    expect(() =>
      renderAssetSvg(
        {
          ...clippedAsset,
          svg: '<svg><use href="https://example.com/a.svg#shape"/></svg>',
        },
        purple,
        'x',
      ),
    ).toThrow(/External SVG references/);
  });
});

describe('renderScene', () => {
  it.each(
    (['canvas1', 'canvas2', 'canvas3'] as const).flatMap((canvasId) =>
      schemes.flatMap((scheme) =>
        (['L', 'S'] as const).map((canvasSize) => ({
          canvasId,
          canvasSize,
          scheme,
          schemeId: scheme.id,
        })),
      ),
    ),
  )(
    'renders the selected $canvasId/$canvasSize in the independent $schemeId scheme with literal colors',
    ({ canvasId, canvasSize, scheme }) => {
      const svg = renderScene(
        { ...scene, canvasId, canvasSize, schemeId: scheme.id },
        manifest,
        schemes,
        'export',
      );
      const root = parseSvg(svg).documentElement!;
      expect(root.getAttribute('viewBox')).toBe('0 0 1000 1000');
      expect(root.getAttribute('width')).toBe('1000');
      expect(root.getAttribute('height')).toBe('1000');
      expect(root.getAttribute('overflow')).toBe('hidden');
      const canvas = elements(svg, 'g').find((group) =>
        group.hasAttribute('data-canvas-id'),
      )!;
      expect(canvas.getAttribute('data-canvas-id')).toBe(canvasId);
      expect(canvas.getAttribute('data-detail-size')).toBe(canvasSize);
      const nested = canvas.getElementsByTagName('svg')[0];
      expect(nested.getAttribute('viewBox')).toBe(
        canvasSize === 'S' ? '0 0 500 500' : '0 0 1000 1000',
      );
      expect(canvas.getAttribute('transform')).toBe(
        canvasSize === 'S'
          ? 'translate(500 500) scale(2) translate(-250 -250)'
          : 'translate(500 500) scale(1) translate(-500 -500)',
      );
      const canvasSvg = serializeSvg(canvas.getElementsByTagName('svg')[0]);
      const paints = visiblePaints(canvasSvg);
      expect(paints).toEqual(
        expect.arrayContaining([
          scheme.colors.bg1,
          scheme.colors.bg2,
          scheme.colors.bg3,
        ]),
      );
      expect(
        paints.every((paint) =>
          [
            scheme.colors.bg1,
            scheme.colors.bg2,
            scheme.colors.bg3,
            scheme.colors.white,
          ].includes(paint),
        ),
      ).toBe(true);
      expect(
        elements(canvasSvg, 'path').map((path) => path.getAttribute('d')),
      ).toEqual(
        elements(assetFor(canvasId, canvasSize).svg, 'path').map((path) =>
          path.getAttribute('d'),
        ),
      );
      expect(itemGroup(svg).getAttribute('data-asset-id')).toBe('phone');
      expect(svg).not.toMatch(/var\s*\(|<(?:image|foreignObject|style)\b/);
      expect(elements(svg, 'path').length).toBeGreaterThan(100);
    },
  );

  it('changes only the underlay while preserving object detail, pose, manual scale and colors', () => {
    const customized: Scene = {
      ...scene,
      schemeId: 'teal',
      items: [
        {
          ...scene.items[0],
          assetId: 'wallet',
          size: 'S',
          scale: 0.8,
          colorOverrides: { main: { bg1: 'obj1' } },
        },
        {
          ...scene.items[0],
          id: 'second',
          assetId: 'vase',
          role: 'bg',
          x: 200,
          y: 300,
          rotation: -30,
          scale: 0.6,
          colorOverrides: { bg: { bg1: 'bg2' } },
        },
      ],
    };
    const before = renderScene(customized, manifest, schemes, 'canvas-switch');
    for (const canvasId of ['canvas1', 'canvas2', 'canvas3'] as const) {
      const after = renderScene(
        { ...customized, canvasId, canvasSize: 'S' },
        manifest,
        schemes,
        'canvas-switch',
      );
      for (const item of customized.items) {
        expect(serializeSvg(itemGroup(after, item.id))).toBe(
          serializeSvg(itemGroup(before, item.id)),
        );
      }
      expect(itemPaints(after)).toContain(teal.colors.obj1);
      expect(itemPaints(after, 'second')).toContain(teal.colors.bg2);
    }
    expect(customized.canvasId).toBe('canvas1');
    expect(customized.canvasSize).toBe('L');
    expect(customized.schemeId).toBe('teal');
  });

  it.each(schemes)(
    'preserves white clip geometry and isolated references for canvas2 in $id',
    (scheme) => {
      const selected: Scene = {
        ...scene,
        canvasId: 'canvas2',
        schemeId: scheme.id,
      };
      const svg = renderScene(selected, manifest, schemes, 'canvas-defs');
      const alternate = renderScene(
        selected,
        manifest,
        schemes,
        'other-canvas-defs',
      );
      const preview = renderAssetSvg(
        assetFor('canvas2'),
        scheme,
        'canvas-defs',
      );
      const allIds = [...ids(svg), ...ids(alternate), ...ids(preview)];
      expect(new Set(allIds).size).toBe(allIds.length);
      expect(allIds.length).toBeGreaterThanOrEqual(3);
      for (const source of [svg, alternate, preview]) {
        const clip = elements(source, 'clipPath')[0];
        expect(clip.getElementsByTagName('rect')[0].getAttribute('fill')).toBe(
          'white',
        );
        const clipped = elements(source, 'g').find((group) =>
          group.hasAttribute('clip-path'),
        )!;
        expect(clipped.getAttribute('clip-path')).toBe(
          `url(#${clip.getAttribute('id')})`,
        );
        expect(visiblePaints(source)).toContain(scheme.colors.bg1);
      }
    },
  );

  it('switches one object to its independent S geometry without changing its displayed width, pose or the underlay', () => {
    const large = renderScene(scene, manifest, schemes, 'scene');
    const small = renderScene(
      { ...scene, items: [{ ...scene.items[0], size: 'S' }] },
      manifest,
      schemes,
      'scene',
    );
    expect(itemGroup(large).getAttribute('transform')).toBe(
      'translate(400 600) rotate(15) scale(0.5) translate(-398.5 -231)',
    );
    expect(itemGroup(small).getAttribute('transform')).toBe(
      `translate(400 600) rotate(15) scale(${0.5 * (797 / 399)}) translate(-199.5 -115.5)`,
    );
    expect(itemGroup(large).getElementsByTagName('path').length).toBe(155);
    expect(itemGroup(small).getElementsByTagName('path').length).toBe(96);
    expect(itemGroup(small).getAttribute('data-detail-size')).toBe('S');
    const canvasGroup = (svg: string): Element =>
      elements(svg, 'g').find((group) => group.hasAttribute('data-canvas-id'))!;
    expect(canvasGroup(small).getAttribute('data-detail-size')).toBe('L');
    expect(serializeSvg(canvasGroup(small))).toBe(
      serializeSvg(canvasGroup(large)),
    );
    const smallPaths = Array.from(
      itemGroup(small).getElementsByTagName('path'),
      (path) => path.getAttribute('d'),
    );
    expect(smallPaths).toEqual(
      elements(assetFor('phone', 'S').svg, 'path').map((path) =>
        path.getAttribute('d'),
      ),
    );
  });

  it.each([
    ['wallet', 631, 397, 316, 199],
    ['book', 1446, 977, 723, 489],
    ['vase', 591, 748, 324, 409],
    ['coin', 287, 189, 153, 101],
  ] as const)(
    'preserves each %s source geometry and uniform proportions at default and manual scales in both detail levels',
    (assetId, largeWidth, largeHeight, smallWidth, smallHeight) => {
      const defaultItem = createSceneItem(assetId, 'first');
      expect(defaultItem.scale).toBe(0.35);
      for (const scale of [defaultItem.scale, 0.8]) {
        for (const [size, width, height] of [
          ['L', largeWidth, largeHeight],
          ['S', smallWidth, smallHeight],
        ] as const) {
          const svg = renderScene(
            {
              ...scene,
              items: [
                { ...defaultItem, x: 400, y: 600, rotation: 15, size, scale },
              ],
            },
            manifest,
            schemes,
            'detail-source',
          );
          const group = itemGroup(svg);
          const viewport = group.getElementsByTagName('svg')[0];
          const effectiveScale = scale * (largeWidth / width);
          expect(group.getAttribute('transform')).toBe(
            `translate(400 600) rotate(15) scale(${effectiveScale}) translate(${-width / 2} ${-height / 2})`,
          );
          expect(viewport.getAttribute('width')).toBe(String(width));
          expect(viewport.getAttribute('height')).toBe(String(height));
          expect(viewport.getAttribute('viewBox')).toBe(
            `0 0 ${width} ${height}`,
          );
          expect(width * effectiveScale).toBeCloseTo(largeWidth * scale, 8);
          expect(group.getAttribute('transform')).toMatch(/scale\([-\d.e+]+\)/);
          expect(group.getAttribute('transform')).not.toMatch(
            /scale\([^)]*[, ]/,
          );
          expect(group.getAttribute('data-detail-size')).toBe(size);
          expect(
            Array.from(group.getElementsByTagName('path'), (path) =>
              path.getAttribute('d'),
            ),
          ).toEqual(
            elements(assetFor(assetId, size).svg, 'path').map((path) =>
              path.getAttribute('d'),
            ),
          );
        }
      }
    },
  );

  it('keeps mixed L/S instances independent, including their colors, roles and uniform scales', () => {
    const svg = renderScene(
      {
        ...scene,
        schemeId: 'teal',
        items: [
          {
            ...scene.items[0],
            assetId: 'wallet',
            size: 'S',
            scale: 1,
            colorOverrides: { main: { bg1: 'obj1' } },
          },
          {
            ...scene.items[0],
            id: 'second',
            assetId: 'wallet',
            size: 'L',
            role: 'bg',
            scale: 0.75,
            x: 800,
            y: 200,
            rotation: -30,
          },
        ],
      },
      manifest,
      schemes,
      'mixed-sizes',
    );
    expect(itemGroup(svg).getAttribute('transform')).toBe(
      `translate(400 600) rotate(15) scale(${631 / 316}) translate(-158 -99.5)`,
    );
    expect(itemGroup(svg, 'second').getAttribute('transform')).toBe(
      'translate(800 200) rotate(-30) scale(0.75) translate(-315.5 -198.5)',
    );
    expect(itemGroup(svg).getAttribute('data-detail-size')).toBe('S');
    expect(itemGroup(svg, 'second').getAttribute('data-detail-size')).toBe('L');
    expect(itemPaints(svg)).toContain(teal.colors.obj1);
    expect(itemPaints(svg)).not.toContain(teal.colors.bg1);
    expect(
      itemPaints(svg, 'second').every((paint) =>
        [teal.colors.bg1, teal.colors.bg2, teal.colors.bg3].includes(paint),
      ),
    ).toBe(true);
  });

  it('leaves other instances and their manual sizes unchanged when one object switches detail', () => {
    const mixed: Scene = {
      ...scene,
      items: [
        {
          ...scene.items[0],
          assetId: 'wallet',
          scale: 0.8,
          colorOverrides: { main: { bg1: 'obj1' } },
        },
        {
          ...scene.items[0],
          id: 'second',
          assetId: 'vase',
          size: 'S',
          role: 'bg',
          scale: 0.6,
          x: 700,
        },
      ],
    };
    const before = renderScene(mixed, manifest, schemes, 'mixed-switch');
    const after = renderScene(
      {
        ...mixed,
        items: mixed.items.map((item, index) =>
          index === 0 ? { ...item, size: 'S' } : item,
        ),
      },
      manifest,
      schemes,
      'mixed-switch',
    );
    expect(serializeSvg(itemGroup(after, 'second'))).toBe(
      serializeSvg(itemGroup(before, 'second')),
    );
    expect(itemGroup(before).getAttribute('data-detail-size')).toBe('L');
    expect(itemGroup(after).getAttribute('data-detail-size')).toBe('S');
    expect(itemPaints(before)).toContain(purple.colors.obj1);
    expect(itemPaints(after)).toContain(purple.colors.obj1);
    expect(itemPaints(after)).not.toContain(purple.colors.bg1);
  });

  it('renders independent S paths and uses only L geometry metadata to normalize its display size', () => {
    const svg = renderScene(
      { ...scene, items: [{ ...scene.items[0], size: 'S' }] },
      {
        version: 1,
        assets: [
          assetFor('canvas1'),
          {
            ...assetFor('phone'),
            svg: '<svg><image href="unused.svg"/></svg>',
          },
          assetFor('phone', 'S'),
        ],
      },
      schemes,
      'independent-small',
    );
    expect(itemGroup(svg).getElementsByTagName('path').length).toBe(96);
    expect(itemGroup(svg).getAttribute('data-detail-size')).toBe('S');
    expect(svg).not.toContain('unused.svg');
    expect(() =>
      renderScene(
        { ...scene, items: [{ ...scene.items[0], size: 'S' }] },
        { version: 1, assets: [assetFor('canvas1'), assetFor('phone', 'S')] },
        schemes,
        'missing-large-metadata',
      ),
    ).toThrow(/object asset: phone__L/);
  });

  it.each(['canvas1', 'canvas2', 'canvas3'] as const)(
    'renders the independent S underlay for %s without requiring or reading its L artwork',
    (canvasId) => {
      const svg = renderScene(
        { ...scene, canvasId, canvasSize: 'S' },
        {
          ...manifest,
          assets: manifest.assets.filter(
            (asset) => asset.id !== canvasId || asset.size === 'S',
          ),
        },
        schemes,
        'small-underlay',
      );
      const canvas = elements(svg, 'g').find(
        (group) => group.getAttribute('data-canvas-id') === canvasId,
      )!;
      const paths = Array.from(canvas.getElementsByTagName('path'), (path) =>
        path.getAttribute('d'),
      );
      expect(paths).toEqual(
        elements(assetFor(canvasId, 'S').svg, 'path').map((path) =>
          path.getAttribute('d'),
        ),
      );
      expect(paths).not.toEqual(
        elements(assetFor(canvasId, 'L').svg, 'path').map((path) =>
          path.getAttribute('d'),
        ),
      );
      expect(svg).not.toMatch(/var\s*\(|<(?:image|foreignObject|style)\b/);
      expect(serializeSvg(itemGroup(svg))).toBe(
        serializeSvg(
          itemGroup(renderScene(scene, manifest, schemes, 'small-underlay')),
        ),
      );
    },
  );

  it.each(['L', 'S'] as const)(
    'centers nonzero viewBoxes using only uniform scaling for a rectangular %s underlay',
    (canvasSize) => {
      const small = {
        ...clippedAsset,
        size: 'S' as const,
        width: 200,
        height: 90,
        viewBox: '10 -20 200 90',
        svg: clippedAsset.svg.replace(
          'viewBox="-30 20 400 180"',
          'viewBox="10 -20 200 90"',
        ),
      };
      const canvas: LibraryAsset = {
        ...assetFor('canvas1', canvasSize),
        width: 800,
        height: 400,
        viewBox: '10 20 800 400',
        svg: '<svg width="800" height="400" viewBox="10 20 800 400"><rect x="10" y="20" width="800" height="400" fill="var(--bg1)"/></svg>',
      };
      const svg = renderScene(
        {
          ...scene,
          width: 1000,
          height: 500,
          canvasSize,
          items: [{ ...scene.items[0], assetId: 'book', size: 'S' }],
        },
        { version: 1, assets: [clippedAsset, small, canvas] },
        schemes,
        'rectangular',
      );
      expect(itemGroup(svg).getAttribute('transform')).toBe(
        'translate(400 600) rotate(15) scale(1) translate(-110 -25)',
      );
      const nested = itemGroup(svg).getElementsByTagName('svg')[0];
      expect(
        ['x', 'y', 'width', 'height', 'viewBox'].map((name) =>
          nested.getAttribute(name),
        ),
      ).toEqual(['10', '-20', '200', '90', '10 -20 200 90']);
      const canvasGroup = elements(svg, 'g').find((group) =>
        group.hasAttribute('data-canvas-id'),
      )!;
      expect(canvasGroup.getAttribute('transform')).toBe(
        'translate(500 250) scale(1.25) translate(-410 -220)',
      );
      for (const group of [itemGroup(svg), canvasGroup]) {
        expect(group.getAttribute('transform')).toMatch(/scale\([-\d.e+]+\)/);
        expect(group.getAttribute('transform')).not.toMatch(/scale\([^)]*[, ]/);
      }
    },
  );

  it('gives repeated clipped instances unique definitions, internal refs and separate preview/scene scopes', () => {
    const fixture = {
      version: 1 as const,
      assets: [
        ...manifest.assets.filter((asset) => asset.id !== 'book'),
        clippedAsset,
      ],
    };
    const svg = renderScene(
      {
        ...scene,
        items: ['same id', 'same/id', 'same_id', 'книга'].map((id) => ({
          ...scene.items[0],
          id,
          assetId: 'book' as const,
        })),
      },
      fixture,
      schemes,
      'preview:canvas/1',
    );
    const preview = renderAssetSvg(clippedAsset, purple, 'preview:canvas/1');
    const allIds = [...ids(svg), ...ids(preview)];
    expect(allIds.length).toBeGreaterThan(10);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const group of elements(svg, 'g').filter((element) =>
      element.hasAttribute('data-item-id'),
    )) {
      const clip = group
        .getElementsByTagName('clipPath')[0]
        .getAttribute('id')!;
      const inner = Array.from(group.getElementsByTagName('g')).find(
        (element) => element.hasAttribute('clip-path'),
      )!;
      expect(inner.getAttribute('clip-path')).toBe(`url(#${clip})`);
      expect(group.getElementsByTagName('use')[0].getAttribute('href')).toBe(
        `#${group.getElementsByTagName('path')[0].getAttribute('id')}`,
      );
    }
    const otherScene = renderScene(scene, manifest, schemes, 'another scene');
    expect(ids(otherScene).every((id) => !allIds.includes(id))).toBe(true);
  });

  it('exports reordered layers in SVG paint order above the unchanged underlay without changing any object', () => {
    const layered: Scene = {
      ...scene,
      canvasId: 'canvas2',
      schemeId: 'teal',
      items: [
        {
          ...scene.items[0],
          assetId: 'wallet',
          colorOverrides: { main: { bg1: 'obj1' } },
        },
        {
          ...scene.items[0],
          id: 'middle',
          assetId: 'book',
          size: 'S',
          role: 'bg',
          scale: 0.8,
        },
        {
          ...scene.items[0],
          id: 'top',
          assetId: 'vase',
          x: 200,
          y: 300,
          rotation: -20,
        },
      ],
    };
    const original = renderScene(layered, manifest, schemes, 'layer-order');
    const reordered = renderScene(
      setSceneItemLayer(layered, 'first', 3),
      manifest,
      schemes,
      'layer-order',
    );
    const root = parseSvg(reordered).documentElement!;
    const children = Array.from(root.childNodes).filter(
      (node): node is Element => node.nodeType === 1,
    );
    expect(
      children.map(
        (child) =>
          child.getAttribute('data-item-id') ??
          child.getAttribute('data-canvas-id'),
      ),
    ).toEqual(['canvas2', 'middle', 'top', 'first']);
    const underlay = (svg: string) =>
      elements(svg, 'g').find((group) => group.hasAttribute('data-canvas-id'))!;
    expect(serializeSvg(underlay(reordered))).toBe(
      serializeSvg(underlay(original)),
    );
    for (const item of layered.items) {
      expect(serializeSvg(itemGroup(reordered, item.id))).toBe(
        serializeSvg(itemGroup(original, item.id)),
      );
    }
    expect(itemPaints(reordered)).toContain(teal.colors.obj1);
    expect(reordered).not.toMatch(
      /z-index|<style|<button|object-layer-toolbar/,
    );
    const lowered = renderScene(
      setSceneItemLayer(layered, 'top', 1),
      manifest,
      schemes,
      'layer-order',
    );
    expect(
      elements(lowered, 'g')
        .filter((group) => group.hasAttribute('data-item-id'))
        .map((group) => group.getAttribute('data-item-id')),
    ).toEqual(['top', 'first', 'middle']);
    expect(layered.items.map((item) => item.id)).toEqual([
      'first',
      'middle',
      'top',
    ]);
  });

  it('uses the background variant while preserving order and item selection ids', () => {
    const svg = renderScene(
      {
        ...scene,
        items: [
          { ...scene.items[0], role: 'bg' },
          { ...scene.items[0], id: 'second', role: 'main' },
        ],
      },
      manifest,
      schemes,
      'role-test',
    );
    const groups = elements(svg, 'g').filter((group) =>
      group.hasAttribute('data-item-id'),
    );
    expect(groups.map((group) => group.getAttribute('data-item-id'))).toEqual([
      'first',
      'second',
    ]);
    const paints = Array.from(groups[0].getElementsByTagName('path'), (path) =>
      path.getAttribute('fill'),
    );
    expect(
      paints.every((paint) =>
        [purple.colors.bg1, purple.colors.bg2, purple.colors.bg3].includes(
          paint!,
        ),
      ),
    ).toBe(true);
    expect(
      Array.from(groups[1].getElementsByTagName('path'), (path) =>
        path.getAttribute('fill'),
      ),
    ).toContain(purple.colors.black);
  });

  it('rejects missing assets/schemes, duplicate ids and invalid geometry', () => {
    for (const canvasId of ['canvas4', 'phone']) {
      expect(() =>
        renderScene(
          { ...scene, canvasId: canvasId as Scene['canvasId'] },
          manifest,
          schemes,
          'x',
        ),
      ).toThrow(/canvas asset/);
    }
    for (const assets of [
      manifest.assets.filter(
        (asset) => asset.id !== 'canvas1' || asset.size !== 'L',
      ),
      [...manifest.assets, assetFor('canvas1')],
    ]) {
      expect(() =>
        renderScene(scene, { version: 1, assets }, schemes, 'x'),
      ).toThrow(/canvas asset: canvas1__L/);
    }
    expect(() =>
      renderScene(
        { ...scene, canvasSize: 'S' },
        {
          ...manifest,
          assets: manifest.assets.filter(
            (asset) => asset.id !== 'canvas1' || asset.size !== 'S',
          ),
        },
        schemes,
        'missing-small-underlay',
      ),
    ).toThrow(/canvas asset: canvas1__S/);
    expect(() =>
      renderScene(
        { ...scene, schemeId: 'missing' as Scene['schemeId'] },
        manifest,
        schemes,
        'x',
      ),
    ).toThrow(/scheme/);
    expect(() =>
      renderScene(scene, { version: 1, assets: [] }, schemes, 'x'),
    ).toThrow(/asset/);
    expect(() =>
      renderScene(
        { ...scene, items: [scene.items[0], scene.items[0]] },
        manifest,
        schemes,
        'x',
      ),
    ).toThrow(/duplicate scene item id/);
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        renderScene({ ...scene, width }, manifest, schemes, 'x'),
      ).toThrow(/dimensions/);
    }
    expect(() =>
      renderScene(
        {
          ...scene,
          items: [{ ...scene.items[0], size: 'M' as AssetSize }],
        },
        manifest,
        schemes,
        'x',
      ),
    ).toThrow(/object asset: phone__M/);
    for (const patch of [
      { scale: 0 },
      { scale: -1 },
      { x: Number.NaN },
      { rotation: Number.POSITIVE_INFINITY },
    ]) {
      expect(() =>
        renderScene(
          { ...scene, items: [{ ...scene.items[0], ...patch }] },
          manifest,
          schemes,
          'x',
        ),
      ).toThrow(/geometry/);
    }
    for (const viewBox of ['0 0 0 10', '0 0 -1 10', '0 0 1', '0 0 NaN 10']) {
      expect(() =>
        renderAssetSvg({ ...clippedAsset, viewBox }, purple, 'x'),
      ).toThrow(/geometry/);
    }
  });
});

describe('per-instance object colors', () => {
  it.each(['L', 'S'] as const)(
    'recolors the real wallet %s body yellow while preserving contours, details and neutral paints',
    (size) => {
      const wallet = assetFor('wallet', size);
      const original = wallet.svg;
      const sourcePaths = elements(original, 'path');
      const svg = renderAssetSvg(wallet, purple, 'yellow-wallet', 'main', {
        bg1: 'obj1',
      });
      const paths = elements(svg, 'path');
      const bodyIndexes = sourcePaths.flatMap((path, index) =>
        path.getAttribute('fill') === 'var(--bg1)' ? [index] : [],
      );
      expect(bodyIndexes.length).toBeGreaterThan(0);
      expect(paths).toHaveLength(sourcePaths.length);
      for (const index of bodyIndexes) {
        expect(paths[index].getAttribute('fill')).toBe('#F9ECB0');
      }
      for (const [index, source] of sourcePaths.entries()) {
        const result = paths[index];
        expect(result.getAttribute('d')).toBe(source.getAttribute('d'));
        expect(result.getAttribute('stroke-width')).toBe(
          source.getAttribute('stroke-width'),
        );
        for (const paint of ['fill', 'stroke']) {
          const value = source.getAttribute(paint);
          if (value === 'var(--black)') {
            expect(result.getAttribute(paint)).toBe('#181817');
          }
          if (value === 'var(--white)') {
            expect(result.getAttribute(paint)).toBe('#FFFFFF');
          }
        }
      }
      expect(visiblePaints(svg)).not.toContain(purple.colors.bg1);
      expect(visiblePaints(svg)).toContain(purple.colors.black);
      expect(visiblePaints(svg)).toContain(purple.colors.white);
      expect(svg).not.toMatch(/var\s*\(/);
      expect(wallet.svg).toBe(original);
    },
  );

  it('keeps another instance and the underlay unchanged, and resolves the chosen role in a new scheme', () => {
    const walletScene: Scene = {
      ...scene,
      items: ['first', 'second'].map((id) => ({
        ...scene.items[0],
        id,
        assetId: 'wallet',
      })),
    };
    const baseline = renderScene(walletScene, manifest, schemes, 'colors');
    const customized: Scene = {
      ...walletScene,
      items: walletScene.items.map((item, index) =>
        index === 0
          ? { ...item, colorOverrides: { main: { bg1: 'obj1' } } }
          : item,
      ),
    };
    const svg = renderScene(customized, manifest, schemes, 'colors');
    expect(serializeSvg(itemGroup(svg, 'second'))).toBe(
      serializeSvg(itemGroup(baseline, 'second')),
    );
    const canvasGroup = (source: string): Element =>
      elements(source, 'g').find((group) =>
        group.hasAttribute('data-canvas-id'),
      )!;
    expect(serializeSvg(canvasGroup(svg))).toBe(
      serializeSvg(canvasGroup(baseline)),
    );
    expect(itemPaints(svg)).not.toContain(purple.colors.bg1);
    const recolored = renderScene(
      {
        ...customized,
        schemeId: 'teal',
        items: customized.items.map((item) => ({ ...item, size: 'S' })),
      },
      manifest,
      schemes,
      'colors',
    );
    const customPaints = itemPaints(recolored);
    expect(customPaints).toContain('#FFD4F2');
    expect(customPaints).not.toContain(purple.colors.obj1);
    expect(customPaints).not.toContain(teal.colors.bg1);
    expect(itemPaints(recolored, 'second')).toContain(teal.colors.bg1);
  });

  it('swaps source roles simultaneously and remaps inline fill and stroke without cascading', () => {
    const fixture: LibraryAsset = {
      ...clippedAsset,
      svg: `<svg fill="var(--bg1)">
        <path fill="var(--obj1)" stroke="var(--bg1)"/>
        <path style="fill: var(--bg1); stroke: var(--obj1) !important"/>
        <path fill="var(--black)" stroke="var(--white)"/>
      </svg>`,
    };
    const svg = renderAssetSvg(fixture, purple, 'swap', 'main', {
      bg1: 'obj1',
      obj1: 'bg1',
    });
    expect(parseSvg(svg).documentElement!.getAttribute('fill')).toBe(
      purple.colors.obj1,
    );
    const paths = elements(svg, 'path');
    expect(paths[0].getAttribute('fill')).toBe(purple.colors.bg1);
    expect(paths[0].getAttribute('stroke')).toBe(purple.colors.obj1);
    expect(paths[1].getAttribute('style')).toBe(
      `fill: ${purple.colors.obj1}; stroke: ${purple.colors.bg1} !important`,
    );
    expect(paths[2].getAttribute('fill')).toBe(purple.colors.black);
    expect(paths[2].getAttribute('stroke')).toBe(purple.colors.white);
  });

  it('keeps role-specific choices separate and restricts background overrides to background colors', () => {
    const customized: Scene = {
      ...scene,
      items: [
        {
          ...scene.items[0],
          assetId: 'wallet',
          colorOverrides: {
            main: { bg1: 'obj1' },
            bg: { bg1: 'bg2' },
          },
        },
      ],
    };
    const svg = renderScene(
      {
        ...customized,
        items: [{ ...customized.items[0], role: 'bg' }],
      },
      manifest,
      schemes,
      'background-colors',
    );
    expect(itemPaints(svg)).toEqual(
      expect.arrayContaining([purple.colors.bg2, purple.colors.bg3]),
    );
    expect(
      itemPaints(svg).every((paint) =>
        [purple.colors.bg1, purple.colors.bg2, purple.colors.bg3].includes(
          paint,
        ),
      ),
    ).toBe(true);
    expect(() =>
      renderAssetSvg(assetFor('wallet'), purple, 'invalid-bg', 'bg', {
        bg1: 'obj1',
      }),
    ).toThrow();
    expect(() =>
      renderAssetSvg(assetFor('wallet'), purple, 'invalid-main', 'main', {
        black: 'obj1',
      }),
    ).toThrow();
    expect(() =>
      renderAssetSvg(assetFor('wallet'), purple, 'invalid-main', 'main', {
        bg1: 'white',
      }),
    ).toThrow();
  });

  it('preserves definition paints and exports distinct, resolved references for customized copies', () => {
    const customized: Scene = {
      ...scene,
      items: ['first', 'second'].map((id) => ({
        ...scene.items[0],
        id,
        assetId: 'book',
        colorOverrides: { main: { obj2: 'obj1', bg2: 'bg3' } },
      })),
    };
    const svg = renderScene(
      customized,
      {
        version: 1,
        assets: [
          ...manifest.assets.filter((asset) => asset.id !== 'book'),
          clippedAsset,
        ],
      },
      schemes,
      'custom-definitions',
    );
    const allIds = ids(svg);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(svg).not.toMatch(/var\s*\(|<(?:image|foreignObject|style)\b/);
    for (const id of ['first', 'second']) {
      const group = itemGroup(svg, id);
      const clip = group.getElementsByTagName('clipPath')[0];
      expect(clip.getElementsByTagName('rect')[0].getAttribute('fill')).toBe(
        'white',
      );
      expect(
        group.getElementsByTagName('stop')[0].getAttribute('stop-color'),
      ).toBe('#123456');
      expect(group.getElementsByTagName('path')[0].getAttribute('stroke')).toBe(
        purple.colors.black,
      );
      const inner = Array.from(group.getElementsByTagName('g')).find((entry) =>
        entry.hasAttribute('clip-path'),
      )!;
      expect(inner.getAttribute('clip-path')).toBe(
        `url(#${clip.getAttribute('id')})`,
      );
    }
  });
});

describe('rendering imported SVG objects', () => {
  const customAsset: LibraryAsset = {
    id: 'custom-1',
    size: 'L',
    kind: 'object',
    sourceScheme: 'purple',
    width: 24,
    height: 12,
    viewBox: '-12 5 24 12',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 5 24 12"><path fill="#E65100" d="M-12 5h24v12h-24z"/></svg>',
  };
  const customScene: Scene = {
    ...scene,
    items: [{ ...createSceneItem('custom-1', 'imported'), scale: 10 }],
  };

  it('centers a registered single-variant import while preserving paths, colors, and proportions', () => {
    const svg = renderScene(
      customScene,
      { ...manifest, assets: [...manifest.assets, customAsset] },
      schemes,
      'custom-test',
    );
    const group = itemGroup(svg, 'imported');
    expect(group.getAttribute('transform')).toBe(
      'translate(500 500) rotate(0) scale(10) translate(0 -11)',
    );
    expect(itemPaints(svg, 'imported')).toEqual(['#E65100']);
    expect(group.getElementsByTagName('path')[0].getAttribute('d')).toBe(
      'M-12 5h24v12h-24z',
    );
    expect(group.getElementsByTagName('svg')[0].getAttribute('viewBox')).toBe(
      '-12 5 24 12',
    );
  });

  it('requires the imported ID and requested variant to exist in the registered manifest', () => {
    expect(() =>
      renderScene(customScene, manifest, schemes, 'missing-import'),
    ).toThrow(/custom-1__L/);
    const smallScene: Scene = {
      ...customScene,
      items: [{ ...customScene.items[0], size: 'S' }],
    };
    expect(() =>
      renderScene(
        smallScene,
        { ...manifest, assets: [...manifest.assets, customAsset] },
        schemes,
        'missing-detail',
      ),
    ).toThrow(/custom-1__S/);
  });
});

describe('rendering session palettes', () => {
  const custom = createCustomScheme('custom-scheme-1', 'Своя схема', {
    bg1: '#102030',
    bg2: '#405060',
    bg3: '#708090',
    black: '#010203',
    obj1: '#A0B0C0',
    obj2: '#D0E0F0',
    obj3: '#F0A050',
    white: '#FAFBFC',
  });
  const imported: LibraryAsset = {
    id: 'custom-palette-probe',
    size: 'L',
    kind: 'object',
    sourceScheme: 'purple',
    width: 100,
    height: 100,
    viewBox: '0 0 100 100',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="clip"><rect width="100" height="100" fill="white"/></clipPath></defs><g clip-path="url(#clip)">${COLOR_ROLES.map((role, index) => `<rect x="${index}" width="1" height="100" fill="var(--${role})"/>`).join('')}</g></svg>`,
    backgroundSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="var(--bg1)"/><path d="M0 0h10" fill="none" stroke="var(--bg2)"/><path d="M0 10h10" stroke="var(--bg3)"/></svg>',
  };

  it('recolors the independent canvas, main/background objects, neutral roles, and overrides for export', () => {
    const customScene: Scene = {
      ...scene,
      canvasId: 'canvas2',
      schemeId: custom.id,
      items: [
        {
          ...createSceneItem('custom-palette-probe', 'first'),
          colorOverrides: { main: { bg1: 'obj1', obj1: 'bg1' } },
        },
        {
          ...createSceneItem('custom-palette-probe', 'back'),
          role: 'bg',
          colorOverrides: { bg: { bg1: 'bg2' } },
        },
      ],
    };
    const before = structuredClone(customScene);
    const svg = renderScene(
      customScene,
      { version: 1, assets: [...manifest.assets, imported] },
      [...schemes, custom],
      'custom-palette',
    );
    const canvasGroup = elements(svg, 'g').find(
      (group) => group.getAttribute('data-canvas-id') === 'canvas2',
    )!;
    expect(canvasGroup).toBeDefined();
    expect(
      visiblePaints(serializeSvg(canvasGroup.getElementsByTagName('svg')[0])),
    ).toContain(custom.colors.bg1);
    expect(new Set(itemPaints(svg))).toEqual(
      new Set(Object.values(custom.colors)),
    );
    const mainRects = Array.from(
      itemGroup(svg)
        .getElementsByTagName('svg')[0]
        .getElementsByTagName('g')[0]
        .getElementsByTagName('rect'),
    );
    expect(mainRects[0].getAttribute('fill')).toBe(custom.colors.obj1);
    expect(mainRects[4].getAttribute('fill')).toBe(custom.colors.bg1);
    expect(new Set(itemPaints(svg, 'back'))).toEqual(
      new Set([custom.colors.bg2, custom.colors.bg3]),
    );
    expect(
      elements(svg, 'clipPath').every(
        (clip) =>
          clip.getElementsByTagName('rect')[0].getAttribute('fill') === 'white',
      ),
    ).toBe(true);
    expect(svg).not.toContain('var(--');
    expect(svg).not.toMatch(/<(?:image|foreignObject|style)\b/);
    expect(customScene).toEqual(before);
  });

  it('rejects a session palette not registered exactly once', () => {
    const customScene = { ...scene, schemeId: custom.id };
    for (const registry of [schemes, [...schemes, custom, { ...custom }]]) {
      expect(() =>
        renderScene(customScene, manifest, registry, 'custom-missing'),
      ).toThrow(/Unknown or duplicate color scheme: custom-scheme-1/);
    }
  });

  it('retains role identity when several palette roles share a visible color', () => {
    const duplicateColors = Object.fromEntries(
      COLOR_ROLES.map((role) => [role, '#abc']),
    ) as Record<ColorRole, string>;
    const duplicate = createCustomScheme(
      'custom-scheme-2',
      'Один цвет',
      duplicateColors,
    );
    const svg = renderAssetSvg(imported, duplicate, 'duplicate-custom');
    expect(new Set(visiblePaints(svg))).toEqual(new Set(['#AABBCC']));
    expect(
      elements(svg, 'clipPath')[0]
        .getElementsByTagName('rect')[0]
        .getAttribute('fill'),
    ).toBe('white');
  });
});
