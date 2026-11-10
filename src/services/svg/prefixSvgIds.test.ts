import { describe, expect, it } from 'vitest';
import { prefixSvgIds } from './prefixSvgIds';
import { parseSvg } from './svgDocument';

const SOURCE =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="asset" aria-labelledby="title"><title id="title">Example</title><defs><clipPath id="clip"><path fill="white" d="M0 0H10V10Z"/></clipPath><linearGradient id="paint"><stop stop-color="#fff"/></linearGradient><mask id="mask"><use href="#shape" fill="white"/></mask><filter id="filter"/><path id="shape" fill="#181817" d="M1 2L3 4"/></defs><path id="visible" fill="url(#paint)" stroke="var(--black)" clip-path="url(#clip)" mask="url(#mask)" filter="url(#filter)" style="fill:url(&quot;#paint&quot;)"/><use href="#shape" xlink:href="#shape"/><animate begin="visible.click; visible.end+1s" end="visible.end"/></svg>';

describe('prefixSvgIds', () => {
  it('gives two inserted assets distinct ids and updates all local references', () => {
    const first = parseSvg(prefixSvgIds(SOURCE, 'scene_1'));
    const second = parseSvg(prefixSvgIds(SOURCE, 'scene_2'));
    const collectIds = (document: ReturnType<typeof parseSvg>) =>
      Array.from(document.getElementsByTagName('*'))
        .filter((element) => element.hasAttribute('id'))
        .map((element) => element.getAttribute('id'));

    expect(
      collectIds(first).filter((id) => collectIds(second).includes(id)),
    ).toEqual([]);
    expect(first.documentElement!.getAttribute('id')).toBe('i7_scene_1__asset');
    expect(first.documentElement!.getAttribute('aria-labelledby')).toBe(
      'i7_scene_1__title',
    );
    const visible = Array.from(first.getElementsByTagName('path')).find(
      (path) => path.getAttribute('id') === 'i7_scene_1__visible',
    )!;
    expect(visible.getAttribute('fill')).toBe('url(#i7_scene_1__paint)');
    expect(visible.getAttribute('stroke')).toBe('var(--black)');
    expect(visible.getAttribute('clip-path')).toBe('url(#i7_scene_1__clip)');
    expect(visible.getAttribute('mask')).toBe('url(#i7_scene_1__mask)');
    expect(visible.getAttribute('filter')).toBe('url(#i7_scene_1__filter)');
    expect(visible.getAttribute('style')).toBe(
      'fill:url("#i7_scene_1__paint")',
    );
    const uses = Array.from(first.getElementsByTagName('use'));
    expect(
      uses.every((use) => use.getAttribute('href') === '#i7_scene_1__shape'),
    ).toBe(true);
    expect(uses[1].getAttribute('xlink:href')).toBe('#i7_scene_1__shape');
    const animation = first.getElementsByTagName('animate')[0];
    expect(animation.getAttribute('begin')).toBe(
      'i7_scene_1__visible.click; i7_scene_1__visible.end+1s',
    );
    expect(animation.getAttribute('end')).toBe('i7_scene_1__visible.end');
  });

  it('keeps nested instance prefixes distinct from matching source ids', () => {
    const first = parseSvg(
      prefixSvgIds(
        '<svg><defs><clipPath id="nested__clip"/></defs><path clip-path="url(#nested__clip)"/></svg>',
        'scene',
      ),
    );
    const second = parseSvg(
      prefixSvgIds(
        '<svg><defs><clipPath id="clip"/></defs><path clip-path="url(#clip)"/></svg>',
        'scene__nested',
      ),
    );
    const firstId = first
      .getElementsByTagName('clipPath')[0]
      .getAttribute('id');
    const secondId = second
      .getElementsByTagName('clipPath')[0]
      .getAttribute('id');

    expect(firstId).toBe('i5_scene__nested__clip');
    expect(secondId).toBe('i13_scene__nested__clip');
    expect(firstId).not.toBe(secondId);
    expect(
      first.getElementsByTagName('path')[0].getAttribute('clip-path'),
    ).toBe(`url(#${firstId})`);
    expect(
      second.getElementsByTagName('path')[0].getAttribute('clip-path'),
    ).toBe(`url(#${secondId})`);
  });
  it('leaves definition colors and all geometry unchanged', () => {
    const document = parseSvg(prefixSvgIds(SOURCE, 'item'));
    const paths = Array.from(document.getElementsByTagName('path'));
    expect(paths[0].getAttribute('fill')).toBe('white');
    expect(paths[0].getAttribute('d')).toBe('M0 0H10V10Z');
    expect(paths[1].getAttribute('fill')).toBe('#181817');
    expect(paths[1].getAttribute('d')).toBe('M1 2L3 4');
    expect(
      document.getElementsByTagName('stop')[0].getAttribute('stop-color'),
    ).toBe('#fff');
    expect(
      document
        .getElementsByTagName('mask')[0]
        .getElementsByTagName('use')[0]
        .getAttribute('fill'),
    ).toBe('white');
  });

  it('preserves references to other documents and unknown ids', () => {
    const result = prefixSvgIds(
      '<svg><path id="local" fill="url(#external)"/><use href="other.svg#local"/><use href="#missing"/></svg>',
      'item',
    );
    expect(result).toContain('fill="url(#external)"');
    expect(result).toContain('href="other.svg#local"');
    expect(result).toContain('href="#missing"');
  });

  it.each(['', 'has spaces', '1startsWithDigit', 'injected"quote'])(
    'rejects invalid instance prefix %s',
    (instance) => {
      expect(() => prefixSvgIds('<svg/>', instance)).toThrow('instanceId');
    },
  );

  it('rejects duplicate ids rather than creating ambiguous references', () => {
    expect(() =>
      prefixSvgIds('<svg><path id="same"/><path id="same"/></svg>', 'item'),
    ).toThrow('duplicate id');
  });
});
