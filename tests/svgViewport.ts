import type { Locator } from '@playwright/test';

/** Measure the source frame; SVG boundingBox() only includes painted geometry. */
export async function svgViewportBounds(svg: Locator) {
  return svg.evaluate((element) => {
    if (!(element instanceof SVGSVGElement)) {
      throw new Error('Expected an SVG viewport.');
    }
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Expected an SVG screen transformation.');
    const { x, y, width, height } = element.viewBox.baseVal;
    const corners = [
      new DOMPoint(x, y),
      new DOMPoint(x + width, y),
      new DOMPoint(x, y + height),
      new DOMPoint(x + width, y + height),
    ].map((point) => point.matrixTransform(matrix));
    const minX = Math.min(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    return {
      x: minX,
      y: minY,
      width: Math.max(...corners.map((point) => point.x)) - minX,
      height: Math.max(...corners.map((point) => point.y)) - minY,
    };
  });
}
