import { describe, expect, it } from 'vitest';
import { clientToScenePoint, type AffineMatrix } from './geometry';

const identity: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

describe('clientToScenePoint', () => {
  it.each([null, undefined])(
    'rejects an unavailable SVG matrix: %s',
    (matrix) => {
      expect(clientToScenePoint({ x: 25, y: 50 }, matrix)).toBeUndefined();
    },
  );

  it('inverts a translated and uniformly scaled scene', () => {
    const point = clientToScenePoint(
      { x: 660, y: 510 },
      { a: 0.8, b: 0, c: 0, d: 0.8, e: 340, f: 110 },
    );
    expect(point?.x).toBeCloseTo(400, 10);
    expect(point?.y).toBeCloseTo(500, 10);
  });

  it.each([
    { viewport: 390, side: 358, left: 16, top: 196 },
    { viewport: 1440, side: 760, left: 340, top: 172 },
    { viewport: 900, side: 496, left: 192, top: 184 },
  ])(
    'preserves scene movement in a $viewport px responsive viewport',
    ({ side, left, top }) => {
      const scale = side / 1000;
      const matrix = { a: scale, b: 0, c: 0, d: scale, e: left, f: top };
      const start = clientToScenePoint(
        { x: left + 250 * scale, y: top + 410 * scale },
        matrix,
      );
      const end = clientToScenePoint(
        { x: left + 375 * scale, y: top + 332.5 * scale },
        matrix,
      );
      expect(start?.x).toBeCloseTo(250, 10);
      expect(start?.y).toBeCloseTo(410, 10);
      expect(end?.x).toBeCloseTo(375, 10);
      expect(end?.y).toBeCloseTo(332.5, 10);
    },
  );

  it('handles rotation and shear rather than assuming axis aligned scale', () => {
    expect(
      clientToScenePoint(
        { x: -18, y: 6 },
        { a: 0, b: 2, c: -3, d: 1, e: 12, f: -8 },
      ),
    ).toEqual({ x: 2, y: 10 });
  });

  it('does not clamp coordinates outside the canvas', () => {
    expect(clientToScenePoint({ x: -25, y: 1200 }, identity)).toEqual({
      x: -25,
      y: 1200,
    });
  });

  it('preserves fractional coordinates without rounding', () => {
    expect(
      clientToScenePoint(
        { x: 17.078125, y: -5.484375 },
        { a: 0.5, b: 0, c: 0, d: 0.5, e: 10, f: -8 },
      ),
    ).toEqual({ x: 14.15625, y: 5.03125 });
  });

  it.each([
    { ...identity, a: 0, d: 0 },
    { ...identity, a: 2, b: 4, c: 1, d: 2 },
  ])('rejects singular matrices: %o', (matrix) => {
    expect(clientToScenePoint({ x: 25, y: 50 }, matrix)).toBeUndefined();
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite input %s in either coordinate or any matrix component',
    (invalid) => {
      expect(
        clientToScenePoint({ x: invalid, y: 0 }, identity),
      ).toBeUndefined();
      expect(
        clientToScenePoint({ x: 0, y: invalid }, identity),
      ).toBeUndefined();
      for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
        expect(
          clientToScenePoint({ x: 0, y: 0 }, { ...identity, [key]: invalid }),
        ).toBeUndefined();
      }
    },
  );

  it('rejects a nonfinite result caused by arithmetic overflow', () => {
    expect(
      clientToScenePoint(
        { x: Number.MAX_VALUE, y: 0 },
        { ...identity, e: -Number.MAX_VALUE },
      ),
    ).toBeUndefined();
  });
});
