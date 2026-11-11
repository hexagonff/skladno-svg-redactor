import type { Element } from '@xmldom/xmldom';
import { COLOR_ROLES, type ColorRole } from '../../domain/colors';
import { normalizeColor } from './normalizeColor';
import { prepareSvg } from './prepareSvg';
import { parseSvg, serializeSvg } from './svgDocument';
import { toBackgroundVariant } from './toBackgroundVariant';

export const MAX_SVG_BYTES = 2 * 1024 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const RESERVED_NAMESPACES = new Set([
  SVG_NAMESPACE,
  XMLNS_NAMESPACE,
  XML_NAMESPACE,
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
]);
const EDITOR_NAMESPACES = new Set([
  'http://www.inkscape.org/namespaces/inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
]);
const NON_RENDERING_ELEMENTS = new Set(['metadata', 'title', 'desc']);

/** Descriptive/editor data is discarded, never inserted into the browser. */
function isImportMetadata(element: Element): boolean {
  const namespace = element.namespaceURI;
  return !namespace || namespace === SVG_NAMESPACE
    ? NON_RENDERING_ELEMENTS.has(element.localName ?? element.tagName)
    : EDITOR_NAMESPACES.has(namespace);
}

const MIN_DIMENSION = 1e-6;
const MAX_DIMENSION = 1e6;
const NUMBER_SOURCE = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const NUMBER = new RegExp(`^${NUMBER_SOURCE}$`);
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/;
const SHAPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
]);
const ELEMENTS = new Set(['svg', 'g', 'defs', 'clipPath', ...SHAPES]);
const NAMED_COLORS: Readonly<Record<string, string>> = {
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  aqua: '#00FFFF',
  cyan: '#00FFFF',
  fuchsia: '#FF00FF',
  magenta: '#FF00FF',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  lime: '#00FF00',
  maroon: '#800000',
  olive: '#808000',
  orange: '#FFA500',
  rebeccapurple: '#663399',
};
const PRESENTATION = new Set([
  'fill',
  'stroke',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'clip-path',
  'display',
  'visibility',
  'vector-effect',
]);
const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  svg: ['width', 'height', 'viewBox', 'preserveAspectRatio', 'version'],
  path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'pathLength'],
  circle: ['cx', 'cy', 'r', 'pathLength'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'pathLength'],
  line: ['x1', 'y1', 'x2', 'y2', 'pathLength'],
  polyline: ['points', 'pathLength'],
  polygon: ['points', 'pathLength'],
  clipPath: ['clipPathUnits'],
};

export interface InspectedImportedSvg {
  svg: string;
  width: number;
  height: number;
  viewBox: string;
  colors: string[];
}

function invalid(message: string): never {
  throw new Error(message);
}

function numeric(value: string, attribute: string, minimum = -1e9): number {
  if (!NUMBER.test(value.trim())) invalid(`Недопустимое число в ${attribute}.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || Math.abs(number) > 1e9) {
    invalid(`Значение ${attribute} выходит за допустимые пределы.`);
  }
  return number;
}

function numberList(value: string, attribute: string): number[] {
  const tokens = value.trim().match(new RegExp(NUMBER_SOURCE, 'g')) ?? [];
  const remainder = value.replace(new RegExp(NUMBER_SOURCE, 'g'), '');
  if (!tokens.length || /[^\s,]/.test(remainder))
    invalid(`Некорректный список ${attribute}.`);
  return tokens.map((token) => numeric(token, attribute));
}

function paint(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.toLowerCase() === 'none' ||
    trimmed.toLowerCase() === 'transparent'
  )
    return 'none';
  const normalized =
    normalizeColor(trimmed) ??
    (Object.hasOwn(NAMED_COLORS, trimmed.toLowerCase())
      ? NAMED_COLORS[trimmed.toLowerCase()]
      : undefined);
  if (!normalized) {
    invalid(
      `Цвет «${trimmed}» не поддерживается. Используйте HEX, RGB или базовое имя цвета; прозрачность задавайте через opacity.`,
    );
  }
  return normalized;
}

function validatePath(value: string): void {
  if (value.length > 250_000) invalid('Слишком сложный контур SVG.');
  if (!value.trim()) return;
  const tokens =
    value.match(new RegExp(`[a-zA-Z]|${NUMBER_SOURCE}`, 'g')) ?? [];
  if (
    /[^\s,]/.test(
      value.replace(new RegExp(`[a-zA-Z]|${NUMBER_SOURCE}`, 'g'), ''),
    )
  ) {
    invalid('Некорректные данные контура SVG.');
  }
  if (!/^[Mm]$/.test(tokens[0] ?? ''))
    invalid('Контур SVG должен начинаться с M.');
  const arities: Readonly<Record<string, number>> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
  };
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    const upper = command.toUpperCase();
    if (upper === 'Z') continue;
    if (!Object.hasOwn(arities, upper))
      invalid('Неизвестная команда контура SVG.');
    const arity = arities[upper];
    let count = 0;
    while (index < tokens.length && NUMBER.test(tokens[index])) {
      const value = numeric(tokens[index++], 'd');
      if (upper === 'A' && count % 7 < 2 && value < 0)
        invalid('Радиус дуги SVG не может быть отрицательным.');
      if (
        upper === 'A' &&
        [3, 4].includes(count % 7) &&
        value !== 0 &&
        value !== 1
      )
        invalid('Некорректный флаг дуги SVG.');
      count += 1;
    }
    if (!count || count % arity !== 0)
      invalid('Недостаточно координат в контуре SVG.');
  }
}

function validateTransform(value: string): string {
  const expression = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  let match: RegExpExecArray | null;
  let offset = 0;
  let count = 0;
  while ((match = expression.exec(value))) {
    if (/[^\s,]/.test(value.slice(offset, match.index)))
      invalid('Некорректный transform SVG.');
    const argumentsList = numberList(match[2], 'transform');
    const accepted: Readonly<Record<string, readonly number[]>> = {
      matrix: [6],
      translate: [1, 2],
      scale: [1, 2],
      rotate: [1, 3],
      skewX: [1],
      skewY: [1],
    };
    if (
      !Object.hasOwn(accepted, match[1]) ||
      !accepted[match[1]].includes(argumentsList.length)
    )
      invalid('Неподдерживаемый transform SVG.');
    offset = expression.lastIndex;
    count += 1;
  }
  if (!count || count > 100 || /[^\s,]/.test(value.slice(offset)))
    invalid('Некорректный transform SVG.');
  return value.trim();
}

function validateAttribute(name: string, value: string): string {
  const trimmed = value.trim();
  if (name === 'fill' || name === 'stroke') return paint(trimmed);
  if (name === 'id') {
    if (!SAFE_ID.test(trimmed))
      invalid(
        'ID в SVG должен начинаться с латинской буквы или подчёркивания и содержать только буквы, цифры, _, . и -.',
      );
  } else if (name === 'd') validatePath(trimmed);
  else if (name === 'transform') return validateTransform(trimmed);
  else if (name === 'viewBox') {
    const values = numberList(trimmed, name);
    if (values.length !== 4 || values[2] <= 0 || values[3] <= 0)
      invalid('viewBox должен содержать четыре числа и положительные размеры.');
    if (
      values[2] < MIN_DIMENSION ||
      values[3] < MIN_DIMENSION ||
      values[2] > MAX_DIMENSION ||
      values[3] > MAX_DIMENSION
    ) {
      invalid('Размеры viewBox должны быть от 0.000001 до 1000000.');
    }
    return values.join(' ');
  } else if (name === 'points') {
    const values = numberList(trimmed, name);
    if (values.length < 4 || values.length % 2)
      invalid('points должен содержать пары координат.');
  } else if (name === 'clip-path') {
    if (trimmed === 'none') return trimmed;
    const reference =
      /^url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_.-]{0,79})\1\s*\)$/.exec(trimmed);
    if (!reference)
      invalid(
        'clip-path может ссылаться только на внутренний clipPath: url(#id).',
      );
    return `url(#${reference[2]})`;
  } else if (['opacity', 'fill-opacity', 'stroke-opacity'].includes(name)) {
    const opacity = numeric(trimmed, name, 0);
    if (opacity > 1) invalid(`${name} должен быть от 0 до 1.`);
  } else if (name === 'stroke-dasharray') {
    if (trimmed !== 'none') {
      if (numberList(trimmed, name).some((part) => part < 0))
        invalid('stroke-dasharray не может быть отрицательным.');
    }
  } else {
    const enumerations: Readonly<Record<string, readonly string[]>> = {
      'fill-rule': ['nonzero', 'evenodd'],
      'clip-rule': ['nonzero', 'evenodd'],
      'stroke-linecap': ['butt', 'round', 'square'],
      'stroke-linejoin': ['miter', 'round', 'bevel'],
      'vector-effect': ['none', 'non-scaling-stroke'],
      display: ['inline', 'none'],
      visibility: ['visible', 'hidden', 'collapse'],
      clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
      version: ['1.0', '1.1', '2.0'],
    };
    if (Object.hasOwn(enumerations, name)) {
      if (!enumerations[name].includes(trimmed))
        invalid(`Неподдерживаемое значение ${name}.`);
    } else if (name === 'preserveAspectRatio') {
      if (
        !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(
          trimmed,
        )
      )
        invalid('Некорректный preserveAspectRatio.');
    } else {
      const nonnegative = [
        'width',
        'height',
        'r',
        'rx',
        'ry',
        'pathLength',
        'stroke-width',
        'stroke-miterlimit',
      ].includes(name);
      const normalized = trimmed.replace(/px$/i, '');
      return String(numeric(normalized, name, nonnegative ? 0 : -1e9));
    }
  }
  return trimmed;
}

function convertStyle(element: Element): void {
  if (!element.hasAttribute('style')) return;
  const declarations = element.getAttribute('style')!.split(';');
  for (const declaration of declarations) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator < 1) invalid('Некорректный inline style SVG.');
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!PRESENTATION.has(name))
      invalid(`CSS-свойство «${name}» не поддерживается в SVG.`);
    element.setAttribute(name, validateAttribute(name, value));
  }
  element.removeAttribute('style');
}

/** Accept only a small static-vector subset, before any browser insertion. */
export function inspectImportedSvg(source: string): InspectedImportedSvg {
  if (!source.trim()) invalid('SVG-файл пуст.');
  if (
    source.length > MAX_SVG_BYTES ||
    new TextEncoder().encode(source).byteLength > MAX_SVG_BYTES
  )
    invalid('SVG-файл должен быть не больше 2 МБ.');
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    invalid('DOCTYPE и XML-сущности в SVG запрещены.');
  let document: ReturnType<typeof parseSvg>;
  try {
    document = parseSvg(source);
  } catch {
    invalid(
      'Не удалось прочитать SVG. Проверьте XML; image, foreignObject и глобальный style не поддерживаются.',
    );
  }
  const root = document.documentElement!;
  const ids = new Map<string, string>();
  const references: string[] = [];
  const colors = new Set<string>();
  let total = 0;
  let visibleShapes = 0;
  let usesDefaultBlack = false;

  const visit = (
    element: Element,
    depth: number,
    inClip: boolean,
    inheritedFill: string | null,
  ): void => {
    total += 1;
    if (total > 5_000 || depth > 32)
      invalid(
        'SVG слишком сложный: не больше 5000 элементов и 32 уровней вложенности.',
      );
    const name = element.tagName;
    if (
      element.prefix ||
      (element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE) ||
      !ELEMENTS.has(name)
    )
      invalid(
        `Элемент <${name}> не поддерживается. Разрешена только статическая SVG-геометрия и clipPath.`,
      );
    if (name === 'svg' && element !== root)
      invalid('Вложенные svg не поддерживаются.');
    if (inClip && (name === 'defs' || name === 'clipPath'))
      invalid('В clipPath допустимы только группы и геометрия.');
    const definition = inClip || name === 'defs' || name === 'clipPath';
    if (element.attributes.length > 32)
      invalid('Слишком много атрибутов у элемента SVG.');
    convertStyle(element);
    const attributes = Array.from(element.attributes);
    for (const attribute of attributes) {
      const attributeName = attribute.name;
      if (
        attribute.namespaceURI === XMLNS_NAMESPACE ||
        attributeName === 'xmlns' ||
        attributeName.startsWith('xmlns:')
      ) {
        // Namespace declarations contain no rendering instructions or resources.
        // Parsed namespace URIs remain available for validating elements/attributes.
        if (attributeName === 'xmlns' && attribute.value !== SVG_NAMESPACE)
          invalid('Неподдерживаемое пространство имён SVG.');
        if (attributeName !== 'xmlns' || element !== root)
          element.removeAttribute(attributeName);
        continue;
      }
      if (
        /^(?:data-|aria-)/i.test(attributeName) ||
        ['class', 'role', 'focusable', 'tabindex'].includes(attributeName) ||
        (attribute.namespaceURI === XML_NAMESPACE &&
          ['lang', 'space'].includes(attribute.localName ?? '')) ||
        (attribute.namespaceURI &&
          !RESERVED_NAMESPACES.has(attribute.namespaceURI))
      ) {
        // No global styles are accepted, so classes and editor annotations are inert.
        // Keep XML base, SVG/XLink attributes and active content on the strict path.
        element.removeAttribute(attributeName);
        continue;
      }
      if (/^on/i.test(attributeName))
        invalid('Обработчики событий в SVG запрещены.');
      if (
        attribute.namespaceURI ||
        (!PRESENTATION.has(attributeName) &&
          attributeName !== 'id' &&
          attributeName !== 'transform' &&
          !GEOMETRY[name]?.includes(attributeName))
      )
        invalid(`Атрибут «${attributeName}» не поддерживается в SVG.`);
      if (attributeName === 'clip-path' && definition)
        invalid(
          'Вложенные ссылки clip-path внутри определений не поддерживаются.',
        );
      const value = validateAttribute(attributeName, attribute.value);
      element.setAttribute(attributeName, value);
      if (attributeName === 'id') {
        if (ids.has(value)) invalid(`Повторяющийся ID в SVG: ${value}.`);
        ids.set(value, name);
      }
      if (attributeName === 'clip-path' && value !== 'none')
        references.push(value.slice(5, -1));
      if (
        !definition &&
        (attributeName === 'fill' || attributeName === 'stroke') &&
        value !== 'none'
      )
        colors.add(value);
    }
    const fill = element.hasAttribute('fill')
      ? element.getAttribute('fill')!
      : inheritedFill;
    if (!definition && SHAPES.has(name)) {
      visibleShapes += 1;
      if (name !== 'line' && fill === null) usesDefaultBlack = true;
    }
    for (let child = element.firstChild; child;) {
      const next = child.nextSibling;
      if (child.nodeType === 1) {
        const childElement = child as Element;
        if (isImportMetadata(childElement)) {
          element.removeChild(childElement);
          child = next;
          continue;
        }
        if (name === 'defs' && childElement.tagName !== 'clipPath')
          invalid('В defs разрешены только определения clipPath.');
        visit(childElement, depth + 1, inClip || name === 'clipPath', fill);
      } else {
        if (
          (child.nodeType === 3 || child.nodeType === 4) &&
          child.textContent?.trim()
        )
          invalid('Текст в SVG не поддерживается: преобразуйте его в контуры.');
        element.removeChild(child);
      }
      child = next;
    }
  };
  visit(root, 0, false, null);
  if (!visibleShapes) invalid('SVG не содержит видимой геометрии.');
  for (const id of references) {
    if (ids.get(id) !== 'clipPath')
      invalid(`Не найден внутренний clipPath с ID «${id}».`);
  }
  if (usesDefaultBlack) {
    root.setAttribute('fill', '#000000');
    colors.add('#000000');
  }
  if (colors.size > 64)
    invalid('В SVG должно быть не больше 64 разных цветов.');
  const sourceBox = root.getAttribute('viewBox');
  let box = sourceBox ? numberList(sourceBox, 'viewBox') : undefined;
  const width = root.hasAttribute('width')
    ? numeric(root.getAttribute('width')!, 'width', 0)
    : box?.[2];
  const height = root.hasAttribute('height')
    ? numeric(root.getAttribute('height')!, 'height', 0)
    : box?.[3];
  if (
    !(width && height) ||
    width < MIN_DIMENSION ||
    height < MIN_DIMENSION ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    invalid(
      'SVG должен иметь width и height либо viewBox с размерами от 0.000001 до 1000000.',
    );
  }
  box ??= [0, 0, width, height];
  // Keep the source viewport size; its viewBox preserves the source proportions.
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', box.join(' '));
  root.setAttribute('xmlns', SVG_NAMESPACE);
  // Serializing only the validated root also removes XML processing instructions.
  return {
    svg: serializeSvg(root),
    width,
    height,
    viewBox: box.join(' '),
    colors: [...colors],
  };
}

/** Every source paint must have an assigned role before entering the library. */
export function prepareImportedSvg(
  inspected: InspectedImportedSvg,
  colorMap: Readonly<Record<string, ColorRole>>,
): { svg: string; backgroundSvg: string } {
  // Revalidate the trust boundary even if a caller constructs this object itself.
  const safe = inspectImportedSvg(inspected.svg);
  if (
    safe.width !== inspected.width ||
    safe.height !== inspected.height ||
    safe.viewBox !== inspected.viewBox
  ) {
    invalid('Метаданные SVG не соответствуют его геометрии.');
  }
  const normalizedMap: Record<string, ColorRole> = {};
  for (const [color, role] of Object.entries(colorMap)) {
    const normalized = paint(color);
    if (normalized === 'none' || !COLOR_ROLES.includes(role))
      invalid('Некорректное сопоставление цвета и роли.');
    if (
      Object.hasOwn(normalizedMap, normalized) &&
      normalizedMap[normalized] !== role
    )
      invalid('Один цвет не может соответствовать двум ролям.');
    normalizedMap[normalized] = role;
  }
  for (const color of safe.colors) {
    if (!Object.hasOwn(normalizedMap, color))
      invalid(`Не удалось назначить роль цвету ${color}.`);
  }
  const prepared = prepareSvg(safe.svg, normalizedMap);
  if (prepared.warnings.length)
    invalid('Не удалось сопоставить все цвета SVG с ролями палитры.');
  return {
    svg: prepared.svg,
    backgroundSvg: toBackgroundVariant(prepared.svg),
  };
}
