import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { svgViewportBounds } from './svgViewport';

const SPARSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
  <rect x="10" y="20" width="20" height="20" fill="#F9ECB0"/>
</svg>`;
const SOLID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
  <rect x="10" y="20" width="200" height="100" fill="#D7CDF5"/>
</svg>`;

type Point = { x: number; y: number };

function canvas(page: Page) {
  return page.getByLabel('Холст композиции', { exact: true });
}

async function addUploaded(page: Page, source: string, name: string) {
  await page.getByLabel('Файл SVG', { exact: true }).setInputFiles({
    name: `${name}.svg`,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source, 'utf8'),
  });
  await page
    .getByRole('button', { name: `Добавить: ${name}`, exact: true })
    .click();
  const item = canvas(page).locator('[data-item-id]').last();
  const id = await item.getAttribute('data-item-id');
  if (!id) throw new Error('Expected an uploaded scene object.');
  return canvas(page).locator(`[data-item-id="${id}"]`);
}

async function frameOf(item: Locator) {
  return svgViewportBounds(item.locator('svg').first());
}

async function blankPoint(item: Locator): Promise<Point> {
  const frame = await frameOf(item);
  return {
    x: frame.x + frame.width * 0.72,
    y: frame.y + frame.height * 0.65,
  };
}

async function paintedAt(item: Locator, point: Point) {
  return item.locator('rect').evaluate((element, client) => {
    if (!(element instanceof SVGGeometryElement))
      throw new Error('Expected imported SVG geometry.');
    const transform = element.getScreenCTM();
    if (!transform) throw new Error('Expected SVG screen coordinates.');
    return element.isPointInFill(
      new DOMPoint(client.x, client.y).matrixTransform(transform.inverse()),
    );
  }, point);
}

async function clearSelection(page: Page) {
  const board = await svgViewportBounds(canvas(page).locator(':scope > svg'));
  await page.mouse.click(
    board.x + board.width * 0.05,
    board.y + board.height * 0.05,
  );
  await expect(
    page.getByRole('button', { name: 'Удалить выбранный', exact: true }),
  ).toBeDisabled();
}

async function expectSelected(page: Page, item: Locator) {
  const id = await item.getAttribute('data-item-id');
  await expect(
    page.locator(`li[data-layer-id="${id}"] .scene-object`),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function setWidth(page: Page, value: number) {
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill(String(value));
  await width.press('Enter');
  await expect(width).toHaveValue(String(value));
}

async function expectArtworkExport(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Expected an SVG download.');
  const exported = await readFile(path, 'utf8');
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  expect(canonical(exported)).toBe(
    canonical(
      await canvas(page)
        .locator(':scope > svg')
        .evaluate((svg) => svg.outerHTML),
    ),
  );
  const document = new DOMParser().parseFromString(exported, 'image/svg+xml');
  const objects = Array.from(document.getElementsByTagName('g')).filter(
    (group) => group.hasAttribute('data-item-id'),
  );
  expect(objects).toHaveLength(2);
  // Hit testing must not add transparent rectangles or interaction attributes to artwork.
  for (const object of objects)
    expect(object.getElementsByTagName('rect').length).toBe(1);
  expect(exported).not.toMatch(
    /pointer-events|data-hit|data-resize-corner|data-layer-toolbar/,
  );
}

test('empty space inside the source SVG frame selects and drags the object without snapping', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const item = await addUploaded(page, SPARSE_SVG, 'sparse');
  await setWidth(page, 400);
  const initialFrame = await frameOf(item);
  const initialMarkup = await item.innerHTML();
  const point = await blankPoint(item);
  expect(await paintedAt(item, point)).toBe(false);
  await clearSelection(page);

  await page.mouse.move(point.x, point.y);
  await expect(canvas(page)).toHaveCSS('cursor', 'grab');
  await page.mouse.click(point.x, point.y);
  await expectSelected(page, item);
  await expect(page.locator('[data-resize-corner]')).toHaveCount(4);
  expect(await frameOf(item)).toEqual(initialFrame);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 47, point.y - 29, { steps: 8 });
  await page.mouse.up();
  const moved = await frameOf(item);
  expect(moved.x - initialFrame.x).toBeCloseTo(47, 1);
  expect(moved.y - initialFrame.y).toBeCloseTo(-29, 1);
  expect(moved.width).toBeCloseTo(initialFrame.width, 6);
  expect(moved.height).toBeCloseTo(initialFrame.height, 6);
  expect(await item.innerHTML()).toBe(initialMarkup);
  await expectSelected(page, item);

  await clearSelection(page);
  await expect(page.locator('[data-resize-corner]')).toHaveCount(0);
  await expect(canvas(page)).not.toHaveCSS('cursor', 'grab');
  expect(await frameOf(item)).toEqual(moved);
  expect(errors).toEqual([]);
});

test('topmost transparent object wins above lower paint and follows layer order while handles, arrows and export keep working', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const solid = await addUploaded(page, SOLID_SVG, 'solid');
  await setWidth(page, 400);
  const sparse = await addUploaded(page, SPARSE_SVG, 'sparse');
  await setWidth(page, 400);
  const point = await blankPoint(sparse);
  expect(await paintedAt(sparse, point)).toBe(false);
  expect(await paintedAt(solid, point)).toBe(true);
  const solidFrame = await frameOf(solid);
  const sparseFrame = await frameOf(sparse);
  await clearSelection(page);

  // The DOM's painted hit is the lower object, so selecting it would be incorrect.
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-item-id]')
          ?.getAttribute('data-item-id'),
      point,
    ),
  ).toBe(await solid.getAttribute('data-item-id'));
  await page.mouse.click(point.x, point.y);
  await expectSelected(page, sparse);
  const order = page.getByRole('spinbutton', {
    name: 'Порядок слоя',
    exact: true,
  });
  await expect(order).toHaveValue('2');
  await order.fill('1');
  await order.press('Enter');
  await expectSelected(page, sparse);
  await page.mouse.click(point.x, point.y);
  await expectSelected(page, solid);
  await expect(order).toHaveValue('2');
  expect(await frameOf(solid)).toEqual(solidFrame);
  expect(await frameOf(sparse)).toEqual(sparseFrame);

  await page.getByRole('button', { name: 'На слой ниже', exact: true }).click();
  await expectSelected(page, solid);
  await expect(order).toHaveValue('1');
  expect(await frameOf(solid)).toEqual(solidFrame);
  await page.mouse.click(point.x, point.y);
  await expectSelected(page, sparse);

  const handle = await page.locator('[data-resize-corner="se"]').boundingBox();
  if (!handle) throw new Error('Expected a resize handle.');
  const start = {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 15, { steps: 6 });
  await page.mouse.up();
  await expectSelected(page, sparse);
  const resized = await frameOf(sparse);
  expect(resized.width).toBeGreaterThan(sparseFrame.width + 20);
  expect(resized.width / resized.height).toBeCloseTo(2, 6);
  expect(resized.x).toBeCloseTo(sparseFrame.x, 2);
  expect(resized.y).toBeCloseTo(sparseFrame.y, 2);
  expect(await frameOf(solid)).toEqual(solidFrame);
  await expectArtworkExport(page);
  expect(errors).toEqual([]);
});

test.describe('touch selection in empty SVG space', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('a transparent point supports tap selection and proportional dragging without page scroll', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const item = await addUploaded(page, SPARSE_SVG, 'touch-sparse');
    await canvas(page).scrollIntoViewIfNeeded();
    const board = await svgViewportBounds(canvas(page).locator(':scope > svg'));
    await page.touchscreen.tap(
      board.x + board.width * 0.05,
      board.y + board.height * 0.05,
    );
    await expect(page.locator('[data-resize-corner]')).toHaveCount(0);
    const before = await frameOf(item);
    const point = await blankPoint(item);
    expect(await paintedAt(item, point)).toBe(false);
    await page.touchscreen.tap(point.x, point.y);
    await expectSelected(page, item);
    expect(await frameOf(item)).toEqual(before);
    const scroll = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id: 1 }],
    });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: point.x + (24 * step) / 6, y: point.y - (18 * step) / 6, id: 1 },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    const after = await frameOf(item);
    expect(after.x - before.x).toBeCloseTo(24, 1);
    expect(after.y - before.y).toBeCloseTo(-18, 1);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.height).toBeCloseTo(before.height, 6);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await expectSelected(page, item);
    expect(errors).toEqual([]);
    await cdp.detach();
  });
});
