export interface Point {
  x: number;
  y: number;
}

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function clientToScenePoint(
  point: Point,
  matrix: AffineMatrix | null | undefined,
): Point | undefined {
  if (!matrix) {
    return undefined;
  }

  const { a, b, c, d, e, f } = matrix;
  if (![point.x, point.y, a, b, c, d, e, f].every(Number.isFinite)) {
    return undefined;
  }

  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    return undefined;
  }

  const translatedX = point.x - e;
  const translatedY = point.y - f;
  const x = (d * translatedX - c * translatedY) / determinant;
  const y = (a * translatedY - b * translatedX) / determinant;
  return [x, y].every(Number.isFinite) ? { x, y } : undefined;
}
