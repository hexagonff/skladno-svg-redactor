import { describe, expect, it } from 'vitest';
import { prepareSvg } from './prepareSvg';
import { mapSvgPaint, parseSvg } from './svgDocument';

describe('prepareSvg', () => {
  it('normalizes palette keys and inherited paints while preserving geometry', () => {
    const source =
      '<svg width="324" height="409" viewBox="0 0 324 409" fill="rgb(249, 236, 176)" xmlns="http://www.w3.org/2000/svg"><g stroke=" white " transform="translate(2 3) scale(0.5)"><path d="M1 2L3 4" fill="#181817"/></g></svg>';
    const result = prepareSvg(source, {
      'rgb(249 236 176)': 'obj1',
      '#fff': 'white',
      '#181817': 'black',
    });
    const document = parseSvg(result.svg);
    const root = document.documentElement!;
    expect(result.warnings).toEqual([]);
    expect(root.getAttribute('width')).toBe('324');
    expect(root.getAttribute('height')).toBe('409');
    expect(root.getAttribute('viewBox')).toBe('0 0 324 409');
    expect(root.getAttribute('fill')).toBe('var(--obj1)');
    const group = document.getElementsByTagName('g')[0];
    expect(group.getAttribute('stroke')).toBe('var(--white)');
    expect(group.getAttribute('transform')).toBe('translate(2 3) scale(0.5)');
    const path = document.getElementsByTagName('path')[0];
    expect(path.getAttribute('fill')).toBe('var(--black)');
    expect(path.getAttribute('d')).toBe('M1 2L3 4');
  });

  it('resolves the same color independently for the supplied scheme', () => {
    const source = '<svg><path fill="#80DADA"/></svg>';
    const orange = prepareSvg(source, { '#80dada': 'obj2' });
    const teal = prepareSvg(source, { '#80DADA': 'bg2' });
    expect(
      parseSvg(orange.svg).getElementsByTagName('path')[0].getAttribute('fill'),
    ).toBe('var(--obj2)');
    expect(
      parseSvg(teal.svg).getElementsByTagName('path')[0].getAttribute('fill'),
    ).toBe('var(--bg2)');
    expect(orange.warnings).toEqual([]);
    expect(teal.warnings).toEqual([]);
  });

  it('keeps all paint in defs and clipPath, including their own declarations', () => {
    const source =
      '<svg><defs fill="white"><clipPath id="clip" stroke="white"><path fill="white" d="M0 0H1V1Z"/></clipPath><linearGradient id="gradient"><stop stop-color="white"/></linearGradient><path fill="#FF0000" id="definition"/></defs><clipPath id="outside" fill="white"><rect fill="white"/></clipPath><path fill="white" stroke="url(#gradient)" clip-path="url(#clip)"/></svg>';
    const result = prepareSvg(source, { white: 'white' });
    const document = parseSvg(result.svg);
    const definitions = document.getElementsByTagName('defs')[0];
    expect(definitions.getAttribute('fill')).toBe('white');
    expect(
      definitions.getElementsByTagName('path')[0].getAttribute('fill'),
    ).toBe('white');
    expect(
      definitions.getElementsByTagName('path')[1].getAttribute('fill'),
    ).toBe('#FF0000');
    for (const clip of Array.from(document.getElementsByTagName('clipPath'))) {
      expect(
        clip.getAttribute(clip.hasAttribute('fill') ? 'fill' : 'stroke'),
      ).toBe('white');
    }
    const visiblePath = document.documentElement!.lastChild as unknown as {
      getAttribute: (name: string) => string;
    };
    expect(visiblePath.getAttribute('fill')).toBe('var(--white)');
    expect(visiblePath.getAttribute('stroke')).toBe('url(#gradient)');
    expect(visiblePath.getAttribute('clip-path')).toBe('url(#clip)');
    expect(result.warnings).toEqual([]);
  });

  it('maps inline fill and stroke without changing unrelated style declarations', () => {
    const result = prepareSvg(
      '<svg><path style="fill: #fff !important; stroke: rgb(24 24 23); opacity: 0.6;stroke-width: 2"/></svg>',
      { white: 'white', '#181817': 'black' },
    );
    const style = parseSvg(result.svg)
      .getElementsByTagName('path')[0]
      .getAttribute('style');
    expect(style).toBe(
      'fill: var(--white) !important; stroke: var(--black); opacity: 0.6;stroke-width: 2',
    );
    expect(result.warnings).toEqual([]);
  });

  it('keeps special paints and existing role tokens unchanged', () => {
    const source =
      '<svg fill="var(--obj1)"><path fill="none" stroke="currentColor"/><path fill="url(#gradient)"/><g fill="inherit"/></svg>';
    const result = prepareSvg(source, {});
    expect(result.svg).toContain('fill="var(--obj1)"');
    expect(result.svg).toContain('fill="none"');
    expect(result.svg).toContain('stroke="currentColor"');
    expect(result.svg).toContain('fill="url(#gradient)"');
    expect(result.warnings).toEqual([]);
  });

  it('preserves unknown colors and alpha, with deduplicated warnings', () => {
    const result = prepareSvg(
      '<svg><path fill="#abc" stroke="#AABBCC"/><path fill="rgba(255, 255, 255, 0.5)"/><path fill="#FFFFFF80"/></svg>',
      { '#FFFFFF': 'white' },
    );
    expect(result.svg).toContain('fill="#abc"');
    expect(result.svg).toContain('stroke="#AABBCC"');
    expect(result.svg).toContain('fill="rgba(255, 255, 255, 0.5)"');
    expect(result.svg).toContain('fill="#FFFFFF80"');
    expect(result.warnings).toEqual([
      'Unmapped SVG paint: #AABBCC',
      'Unmapped SVG paint: rgba(255, 255, 255, 0.5)',
      'Unmapped SVG paint: #FFFFFF80',
    ]);
  });

  it('does not synthesize a different size or infer missing paints', () => {
    const large = prepareSvg(
      '<svg width="10" height="20"><path fill="white"/></svg>',
      { white: 'white' },
    );
    const small = prepareSvg(
      '<svg width="5" height="11"><path fill="#181817"/><path fill="white"/></svg>',
      { white: 'white', '#181817': 'black' },
    );
    expect(parseSvg(large.svg).getElementsByTagName('path').length).toBe(1);
    expect(parseSvg(small.svg).getElementsByTagName('path').length).toBe(2);
    expect(parseSvg(small.svg).documentElement!.getAttribute('height')).toBe(
      '11',
    );
  });

  it('rejects ambiguous or unsupported palette keys', () => {
    expect(() =>
      prepareSvg('<svg/>', { white: 'white', '#fff': 'obj1' }),
    ).toThrow('conflicting roles');
    expect(() =>
      prepareSvg('<svg/>', { 'rgba(255,255,255,0.5)': 'white' }),
    ).toThrow('non-opaque or unsupported color');
  });

  it.each([
    '<svg><path></svg>',
    '<svg><path fill=white/></svg>',
    '<html/>',
    '<svg/><svg/>',
    '<!DOCTYPE svg><svg/>',
    '<svg><image href="photo.png"/></svg>',
    '<svg><foreignObject/></svg>',
    '<svg><style>path { fill: red }</style></svg>',
  ])('rejects malformed or prohibited SVG: %s', (source) => {
    expect(() => prepareSvg(source, {})).toThrow();
  });
});

describe('mapSvgPaint', () => {
  it('invokes the paint mapper only for visible fill/stroke declarations', () => {
    const seen: string[] = [];
    mapSvgPaint(
      '<svg fill="root"><defs><path fill="definition"/></defs><clipPath stroke="clip"><path fill="clipped"/></clipPath><g stroke="group"><path style="fill: inline; stroke-width: 2"/></g></svg>',
      (value) => {
        seen.push(value);
        return value;
      },
    );
    expect(seen).toEqual(['root', 'group', 'inline']);
  });
});
