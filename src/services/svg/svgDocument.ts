import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element } from '@xmldom/xmldom';

const FORBIDDEN_ELEMENTS = new Set(['image', 'foreignobject', 'style']);

export function visitSvgElements(
  element: Element,
  visitor: (element: Element) => void,
): void {
  visitor(element);
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) visitSvgElements(child as Element, visitor);
  }
}

/** Parses SVG strictly, rejecting content prohibited by the library contract. */
export function parseSvg(svg: string): Document {
  if (/<!DOCTYPE/i.test(svg))
    throw new Error('SVG must not contain a DOCTYPE.');
  const document = new DOMParser({
    onError: (level, message) => {
      throw new Error(`Invalid SVG (${level}): ${message}`);
    },
  }).parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (!root || (root.localName ?? root.tagName).toLowerCase() !== 'svg') {
    throw new Error('Expected an SVG root element.');
  }
  visitSvgElements(root, (element) => {
    if (
      FORBIDDEN_ELEMENTS.has(
        (element.localName ?? element.tagName).toLowerCase(),
      )
    ) {
      throw new Error(`SVG must not contain <${element.tagName}>.`);
    }
  });
  return document;
}

export function serializeSvg(document: Document | Element): string {
  return new XMLSerializer().serializeToString(document);
}

function mapStylePaint(
  style: string,
  mapper: (value: string) => string,
): string {
  return style.replace(
    /(^|;)(\s*(?:fill|stroke)\s*:\s*)([^;]*)/gi,
    (_match, separator: string, property: string, value: string) => {
      const parts = /^(.*?)(\s*!important\s*)?$/i.exec(value)!;
      const paint = parts[1].trim();
      return `${separator}${property}${mapper(paint)}${parts[2] ?? ''}`;
    },
  );
}

/** Changes visible paint declarations, including inherited group/root paints. */
export function mapSvgPaint(
  svg: string,
  mapper: (value: string) => string,
): string {
  const document = parseSvg(svg);
  const visit = (element: Element): void => {
    const name = (element.localName ?? element.tagName).toLowerCase();
    if (name === 'defs' || name === 'clippath') return;

    for (const attribute of ['fill', 'stroke']) {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(
          attribute,
          mapper(element.getAttribute(attribute)!),
        );
      }
    }
    if (element.hasAttribute('style')) {
      element.setAttribute(
        'style',
        mapStylePaint(element.getAttribute('style')!, mapper),
      );
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(document.documentElement!);
  return serializeSvg(document);
}
