import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLOR_ROLES } from '../../domain/colors';
import {
  inspectImportedSvg,
  MAX_SVG_BYTES,
  prepareImportedSvg,
} from './importSvg';
import { prefixSvgIds } from './prefixSvgIds';
import { parseSvg } from './svgDocument';

const svg = (content: string, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" ${attributes}>${content}</svg>`;

function root(source: string) {
  return parseSvg(source).documentElement!;
}

describe('inspectImportedSvg', () => {
  it('normalizes declared colors and converts safe inline style without inserting CSS', () => {
    const result = inspectImportedSvg(
      svg(
        '<g fill="red"><path d="M1 2L3 4Z" stroke="#fff" style="fill: rgb(24 24 23); stroke-width:2; opacity:0.6"/></g>',
        'width="100px" height="80px"',
      ),
    );
    expect(result).toMatchObject({
      width: 100,
      height: 80,
      viewBox: '0 0 100 80',
    });
    expect(result.colors).toEqual(['#FF0000', '#FFFFFF', '#181817']);
    const path = root(result.svg).getElementsByTagName('path')[0];
    expect(path.getAttribute('fill')).toBe('#181817');
    expect(path.getAttribute('stroke')).toBe('#FFFFFF');
    expect(path.getAttribute('stroke-width')).toBe('2');
    expect(path.getAttribute('opacity')).toBe('0.6');
    expect(path.hasAttribute('style')).toBe(false);
    expect(path.getAttribute('d')).toBe('M1 2L3 4Z');
  });

  it('supports only real geometry and keeps a nonzero viewBox origin', () => {
    const result = inspectImportedSvg(
      '<svg width="400" height="200" viewBox="-40 25 200 100"><rect x="-40" y="25" width="200" height="100" fill="white"/></svg>',
    );
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(result.viewBox).toBe('-40 25 200 100');
    expect(root(result.svg).getAttribute('xmlns')).toBe(
      'http://www.w3.org/2000/svg',
    );
    expect(result.colors).toEqual(['#FFFFFF']);
  });

  it('adds a viewBox when only positive pixel dimensions are provided', () => {
    const result = inspectImportedSvg(
      '<svg width="120px" height="60"><circle cx="20" cy="20" r="10"/></svg>',
    );
    expect(result).toMatchObject({
      width: 120,
      height: 60,
      viewBox: '0 0 120 60',
      colors: ['#000000'],
    });
    expect(root(result.svg).getAttribute('fill')).toBe('#000000');
  });

  it('does not invent an unused default black color for explicitly filled shapes or lines', () => {
    expect(
      inspectImportedSvg(svg('<path fill="red" d="M0 0H3V3Z"/>')).colors,
    ).toEqual(['#FF0000']);
    expect(
      inspectImportedSvg(svg('<line x2="10" stroke="blue"/>')).colors,
    ).toEqual(['#0000FF']);
    expect(
      inspectImportedSvg(svg('<rect width="10" height="10" fill="none"/>'))
        .colors,
    ).toEqual([]);
  });

  it('drops unused namespace declarations including C2PA without changing artwork', () => {
    const content = '<path id="art" fill="red" d="M0 0L30 5V20Z"/>';
    const plain = inspectImportedSvg(svg(content));
    const annotated = inspectImportedSvg(
      svg(
        content,
        'xmlns:c2pa="http://c2pa.org/manifest" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:unused="https://metadata.invalid/ns"',
      ),
    );
    expect(annotated).toEqual(plain);
    expect(annotated.svg).not.toMatch(/c2pa|xlink|unused|metadata.invalid/);
    expect(prepareImportedSvg(annotated, { '#FF0000': 'obj1' }).svg).toContain(
      'd="M0 0L30 5V20Z"',
    );
  });

  it('removes RDF/C2PA metadata and editor annotations before validating renderable content', () => {
    const source = svg(
      `
      <title id="title">Название</title>
      <desc>Описание рисунка</desc>
      <metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description c2pa:manifest="https://metadata.invalid/manifest"><c2pa:claim>Описание происхождения</c2pa:claim></rdf:Description></rdf:RDF></metadata>
      <sodipodi:namedview inkscape:zoom="2"/>
      <defs><title>Обрезка</title><clipPath id="cut"><rect width="20" height="10" fill="white"/></clipPath></defs>
      <g inkscape:label="Слой" sodipodi:nodetypes="cc" c2pa:manifest="https://metadata.invalid/manifest" class="button" role="img" aria-labelledby="title" data-name="Art" xml:space="preserve" xml:lang="ru">
        <rect width="30" height="20" fill="red" clip-path="url(#cut)"/>
      </g>`,
      'xmlns:c2pa="http://c2pa.org/manifest" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"',
    );
    const result = inspectImportedSvg(source);
    expect(result.colors).toEqual(['#FF0000']);
    expect(result.svg).not.toMatch(
      /metadata|rdf|c2pa|inkscape|sodipodi|namedview|<title|<desc|class=|role=|aria-|data-|xml:|Описание/,
    );
    expect(root(result.svg).getElementsByTagName('rect')).toHaveLength(2);
    expect(
      root(result.svg)
        .getElementsByTagName('rect')[1]
        .getAttribute('clip-path'),
    ).toBe('url(#cut)');
    expect(prepareImportedSvg(result, { '#FF0000': 'obj2' }).svg).toContain(
      'var(--obj2)',
    );
    expect(source).toContain('c2pa:manifest');
  });

  it('accepts redundant SVG namespace declarations on groups', () => {
    const result = inspectImportedSvg(
      svg(
        '<g xmlns="http://www.w3.org/2000/svg" xmlns:c2pa="http://c2pa.org/manifest"><path fill="red" d="M0 0h1v1z"/></g>',
      ),
    );
    expect(result.colors).toEqual(['#FF0000']);
    expect(result.svg).not.toContain('c2pa');
  });

  it.each([
    '<path onload="alert(1)"/>',
    '<script>alert(1)</script>',
    '<path xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://bad.test/art.svg"/>',
    '<path clip-path="url(https://bad.test/art.svg#cut)"/>',
    '<path xml:base="https://bad.test/"/>',
    '<g xml:base="https://bad.test/"><path/></g>',
    '<path xmlns:svg="http://www.w3.org/2000/svg" svg:onclick="alert(1)"/>',
  ])(
    'metadata cleanup still rejects active/functional attributes: %s',
    (content) => {
      expect(() =>
        inspectImportedSvg(
          svg(content, 'xmlns:c2pa="http://c2pa.org/manifest"'),
        ),
      ).toThrow();
    },
  );

  it('supports independent fill and stroke with inherited group paints', () => {
    const result = inspectImportedSvg(
      svg(
        '<g fill="none" stroke="aqua"><polyline points="1,2 3,4"/><polygon points="1 2 3 4 5 6" fill="#f00"/></g>',
      ),
    );
    expect(result.colors).toEqual(['#00FFFF', '#FF0000']);
  });

  it('removes comments and processing instructions from the validated root', () => {
    const result = inspectImportedSvg(
      `<?xml version="1.0"?><?xml-stylesheet href="https://bad.test/x.css"?>${svg('<!-- comment --><?custom data?><rect width="5" height="5" fill="white"/>')}`,
    );
    expect(result.svg).not.toMatch(/<\?|<!--|bad\.test/);
  });

  it('accepts safe clipPath definitions, preserves their paints and validates internal references', () => {
    const result = inspectImportedSvg(
      svg(
        '<defs><clipPath id="clip_1" clipPathUnits="userSpaceOnUse"><g transform="translate(1 2)"><rect width="20" height="20" fill="white"/></g></clipPath></defs><path fill="red" d="M0 0L20 0V20Z" clip-path="url(\'#clip_1\')"/>',
      ),
    );
    expect(result.colors).toEqual(['#FF0000']);
    const prepared = prepareImportedSvg(result, { '#FF0000': 'obj1' });
    expect(
      root(prepared.svg).getElementsByTagName('rect')[0].getAttribute('fill'),
    ).toBe('#FFFFFF');
    expect(
      root(prepared.svg).getElementsByTagName('path')[0].getAttribute('fill'),
    ).toBe('var(--obj1)');
    const inserted = root(prefixSvgIds(prepared.svg, 'custom_item'));
    const clipId = inserted
      .getElementsByTagName('clipPath')[0]
      .getAttribute('id');
    expect(clipId).not.toBe('clip_1');
    expect(
      inserted.getElementsByTagName('path')[0].getAttribute('clip-path'),
    ).toBe(`url(#${clipId})`);
  });

  it.each([
    ['white', '#FFFFFF'],
    ['BLACK', '#000000'],
    ['#abc', '#AABBCC'],
    ['rgb(100% 0% 0%)', '#FF0000'],
    ['rgba(10,20,30,1)', '#0A141E'],
    ['orange', '#FFA500'],
    ['rebeccapurple', '#663399'],
  ])('normalizes supported paint %s', (paint, expected) => {
    expect(
      inspectImportedSvg(svg(`<rect width="10" height="10" fill="${paint}"/>`))
        .colors,
    ).toEqual([expected]);
  });

  it.each([
    '<script>alert(1)</script>',
    '<g onload="alert(1)"><path/></g>',
    '<path onclick="alert(1)"/>',
    '<a href="https://example.com"><path/></a>',
    '<image href="https://example.com/image.svg"/>',
    '<foreignObject/>',
    '<style>path{fill:red}</style>',
    '<use href="#p"/>',
    '<text>hello</text>',
    '<animate attributeName="fill" values="red;blue"/>',
    '<set attributeName="fill" to="red"/>',
    '<filter id="f"/>',
    '<mask id="mask"/>',
    '<linearGradient id="g"/>',
    '<path fill="url(#gradient)"/>',
    '<path href="javascript:alert(1)"/>',
    '<path xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://bad.test"/>',
    '<path style="background:url(https://bad.test/a)"/>',
    '<path style="fill:var(--x)"/>',
    '<path style="fill:red !important"/>',
    '<path style="stroke:expression(alert(1))"/>',
    '<path fill="currentColor"/>',
    '<path fill="lightgoldenrodyellow"/>',
    '<path fill="rgba(1,2,3,0.5)"/>',
    '<path fill="constructor"/>',
    '<path fill="__proto__"/>',
    '<path transform="constructor(1)"/>',
    '<svg viewBox="0 0 10 10"><path/></svg>',
    '<path xmlns="http://www.w3.org/1999/xhtml"/>',
    '<defs><path id="p"/></defs><path/>',
    '<defs><clipPath id="c"><clipPath id="d"/></clipPath></defs><path/>',
    '<defs><clipPath id="c"><rect clip-path="url(#c)"/></clipPath></defs><path/>',
    '<clipPath id="c"/><path clip-path="url(https://bad.test/a.svg#c)"/>',
    '<path clip-path="url(#missing)"/>',
    '<path id="c"/><path clip-path="url(#c)"/>',
    '<path id="same"/><path id="same"/>',
    '<path id="bad id"/>',
    '<path d="M1 2L3"/>',
    '<path d="L1 2"/>',
    '<path d="M0 0 A1 1 0 2 0 4 4"/>',
    '<path transform="matrix(1 0 0)"/>',
    '<path transform="translate(1) url(a)"/>',
    '<rect width="-1"/>',
    '<circle r="1e100"/>',
    '<path opacity="2"/>',
    '<polyline points="1 2 3"/>',
    'unconverted text',
  ])('rejects unsafe or unsupported content: %s', (content) => {
    expect(() => inspectImportedSvg(svg(content))).toThrow();
  });

  it.each([
    '',
    '<svg/>',
    '<html/>',
    '<svg><path></svg>',
    '<svg/><svg/>',
    '<!DOCTYPE svg><svg/>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
    '<svg width="0" height="2"><path/></svg>',
    '<svg width="100%" height="2"><path/></svg>',
    '<svg width="1" height="2" viewBox="0 0 0 10"><path/></svg>',
    '<svg width="1" height="2" viewBox="0 0 1 2 3"><path/></svg>',
    '<svg xmlns="https://bad.test"><path/></svg>',
  ])('rejects invalid document or dimensions: %s', (source) => {
    expect(() => inspectImportedSvg(source)).toThrow();
  });

  it('rejects microscopic dimensions before fitting an imported object can overflow', () => {
    expect(() =>
      inspectImportedSvg('<svg width="1e-320" height="1"><path/></svg>'),
    ).toThrow('0.000001');
    expect(() =>
      inspectImportedSvg(
        '<svg width="1e-320" height="1" viewBox="0 0 10 10"><path/></svg>',
      ),
    ).toThrow('0.000001');
    expect(() =>
      inspectImportedSvg('<svg viewBox="0 0 1e-320 1"><path/></svg>'),
    ).toThrow('0.000001');
    expect(
      inspectImportedSvg('<svg viewBox="0 0 0.000001 1"><path/></svg>').width,
    ).toBe(0.000001);
  });

  it('bounds UTF-8 upload size, element count, nesting and color count', () => {
    expect(() => inspectImportedSvg(' '.repeat(MAX_SVG_BYTES + 1))).toThrow();
    expect(() =>
      inspectImportedSvg(svg(`<!--${'я'.repeat(MAX_SVG_BYTES / 2)}--><path/>`)),
    ).toThrow('2 МБ');
    expect(() => inspectImportedSvg(svg('<path/>'.repeat(5000)))).toThrow(
      '5000',
    );
    expect(() =>
      inspectImportedSvg(svg(`${'<g>'.repeat(33)}<path/>${'</g>'.repeat(33)}`)),
    ).toThrow('32');
    const colors = Array.from(
      { length: 65 },
      (_, index) => `<path fill="#${index.toString(16).padStart(6, '0')}"/>`,
    ).join('');
    expect(() => inspectImportedSvg(svg(colors))).toThrow('64');
  });

  it.each(['book__L.svg', 'wallet__S.svg', 'lamp__L.svg', 'canvas2__L.svg'])(
    'accepts real Figma vector geometry: %s',
    (name) => {
      const source = readFileSync(
        fileURLToPath(new URL(`../../assets/library/${name}`, import.meta.url)),
        'utf8',
      );
      const result = inspectImportedSvg(source);
      const mapping = Object.fromEntries(
        result.colors.map((color) => [color, 'bg1' as const]),
      );
      expect(() => prepareImportedSvg(result, mapping)).not.toThrow();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    },
  );
});

describe('prepareImportedSvg', () => {
  it('requires explicit mapping for every source paint rather than guessing nearby colors', () => {
    const inspected = inspectImportedSvg(
      svg('<path fill="#D6CDF5" stroke="white"/>'),
    );
    expect(() => prepareImportedSvg(inspected, { '#FFFFFF': 'white' })).toThrow(
      '#D6CDF5',
    );
    const prepared = prepareImportedSvg(inspected, {
      '#D6CDF5': 'bg2',
      white: 'white',
    });
    expect(prepared.svg).toContain('fill="var(--bg2)"');
    expect(prepared.svg).toContain('stroke="var(--white)"');
    expect(prepared.backgroundSvg).toContain('stroke="var(--bg1)"');
    expect(prepared.backgroundSvg).toContain('fill="var(--bg2)"');
  });

  it('converts all object/neutral roles to permitted background colors', () => {
    const inspected = inspectImportedSvg(
      svg(
        COLOR_ROLES.map(
          (_, index) => `<rect width="2" height="3" fill="#00000${index}"/>`,
        ).join(''),
      ),
    );
    const mapping = Object.fromEntries(
      inspected.colors.map((color, index) => [color, COLOR_ROLES[index]]),
    );
    const result = prepareImportedSvg(inspected, mapping);
    const fills = Array.from(
      root(result.backgroundSvg).getElementsByTagName('rect'),
      (element) => element.getAttribute('fill'),
    );
    expect(fills).toEqual([
      'var(--bg1)',
      'var(--bg2)',
      'var(--bg3)',
      'var(--bg3)',
      'var(--bg1)',
      'var(--bg1)',
      'var(--bg1)',
      'var(--bg1)',
    ]);
  });

  it('does not trust constructed inspection objects or stale geometry metadata', () => {
    const inspected = inspectImportedSvg(svg('<path fill="red"/>'));
    expect(() =>
      prepareImportedSvg(
        { ...inspected, svg: svg('<script/>') },
        { red: 'obj1' },
      ),
    ).toThrow();
    expect(() =>
      prepareImportedSvg({ ...inspected, width: 200 }, { red: 'obj1' }),
    ).toThrow('Метаданные');
    expect(() => prepareImportedSvg({ ...inspected, colors: [] }, {})).toThrow(
      '#FF0000',
    );
  });

  it('rejects ambiguous aliases, invalid roles and unsupported mapping colors', () => {
    const inspected = inspectImportedSvg(svg('<path fill="white"/>'));
    expect(() =>
      prepareImportedSvg(inspected, { white: 'white', '#fff': 'obj1' }),
    ).toThrow('двум ролям');
    expect(() =>
      prepareImportedSvg(inspected, { white: 'unknown' as never }),
    ).toThrow('сопоставление');
    expect(() =>
      prepareImportedSvg(inspected, { 'url(#a)': 'white' }),
    ).toThrow();
  });
});
