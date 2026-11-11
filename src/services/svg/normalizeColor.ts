const NAMED_COLORS: Readonly<Record<string, string>> = {
  white: '#FFFFFF',
  black: '#000000',
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function parseNumber(value: string): number | undefined {
  if (!NUMBER.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseChannel(value: string): number | undefined {
  const percentage = value.endsWith('%');
  const parsed = parseNumber(percentage ? value.slice(0, -1) : value);
  if (parsed === undefined) return undefined;
  return Math.round(
    Math.max(0, Math.min(255, percentage ? (parsed * 255) / 100 : parsed)),
  );
}

function isOpaque(value: string): boolean {
  const percentage = value.endsWith('%');
  const parsed = parseNumber(percentage ? value.slice(0, -1) : value);
  return parsed !== undefined && parsed >= (percentage ? 100 : 1);
}

/**
 * Returns an opaque RGB color in #RRGGBB form.
 * Unsupported paints and translucent colors return undefined so their alpha is preserved.
 */
export function normalizeColor(value: string): string | undefined {
  const color = value.trim().toLowerCase();
  if (Object.hasOwn(NAMED_COLORS, color)) return NAMED_COLORS[color];

  if (/^#[\da-f]{3,4}$/i.test(color)) {
    const expanded = color
      .slice(1)
      .split('')
      .map((digit) => digit + digit)
      .join('');
    if (expanded.length === 8 && expanded.slice(6) !== 'ff') return undefined;
    return `#${expanded.slice(0, 6).toUpperCase()}`;
  }

  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) {
    if (color.length === 9 && color.slice(7) !== 'ff') return undefined;
    return color.slice(0, 7).toUpperCase();
  }

  const rgb = /^rgba?\((.*)\)$/i.exec(color);
  if (!rgb) return undefined;
  const body = rgb[1].trim();
  let channels: string[];
  let alpha: string | undefined;

  if (body.includes(',')) {
    if (body.includes('/')) return undefined;
    const components = body.split(',').map((part) => part.trim());
    if (components.length !== 3 && components.length !== 4) return undefined;
    channels = components.slice(0, 3);
    alpha = components[3];
  } else {
    const components = body.split('/');
    if (components.length > 2) return undefined;
    channels = components[0].trim().split(/\s+/);
    alpha = components[1]?.trim();
    if (channels.length !== 3 || alpha === '') return undefined;
  }

  if (alpha !== undefined && !isOpaque(alpha)) return undefined;
  const rgbValues = channels.map(parseChannel);
  if (rgbValues.some((channel) => channel === undefined)) return undefined;
  return `#${rgbValues
    .map((channel) => channel!.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}
