import { parseSvg, serializeSvg, visitSvgElements } from './svgDocument';

/**
 * The caller provides a unique instanceId for each insertion into a scene.
 * Including its length keeps nested instance prefixes unambiguous.
 * This step renames definitions and references without changing their paint.
 */
export function prefixSvgIds(svg: string, instanceId: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(instanceId)) {
    throw new Error(
      'SVG instanceId must start with a letter or underscore and contain only letters, digits, _, . or -.',
    );
  }

  const document = parseSvg(svg);
  const root = document.documentElement!;
  const ids = new Map<string, string>();
  visitSvgElements(root, (element) => {
    if (!element.hasAttribute('id')) return;
    const id = element.getAttribute('id')!;
    if (!id || ids.has(id))
      throw new Error(`SVG contains an empty or duplicate id: ${id}`);
    ids.set(id, `i${instanceId.length}_${instanceId}__${id}`);
  });

  visitSvgElements(root, (element) => {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)!;
      const name = attribute.name.toLowerCase();
      let value = attribute.value;
      if (name === 'id') {
        value = ids.get(value)!;
      } else {
        value = value.replace(
          /url\(\s*(['"]?)#([^\s)'"]+)\1\s*\)/gi,
          (original: string, quote: string, id: string) => {
            const replacement = ids.get(id);
            return replacement === undefined
              ? original
              : `url(${quote}#${replacement}${quote})`;
          },
        );

        if (
          (name === 'href' || name === 'xlink:href') &&
          value.startsWith('#')
        ) {
          const replacement = ids.get(value.slice(1));
          if (replacement !== undefined) value = `#${replacement}`;
        } else if (name === 'aria-labelledby' || name === 'aria-describedby') {
          value = value.replace(/\S+/g, (id) => ids.get(id) ?? id);
        } else if (name === 'begin' || name === 'end') {
          value = value.replace(
            /(^|;)(\s*)([^;\s]+?)(?=\.)/g,
            (
              original: string,
              separator: string,
              spacing: string,
              id: string,
            ) => {
              const replacement = ids.get(id);
              return replacement === undefined
                ? original
                : `${separator}${spacing}${replacement}`;
            },
          );
        }
      }
      attribute.value = value;
    }
  });
  return serializeSvg(document);
}
