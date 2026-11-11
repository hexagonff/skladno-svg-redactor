import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';

function sceneSvg(page: Page) {
  return page
    .getByLabel('Холст композиции', { exact: true })
    .locator(':scope > svg');
}

function rotationControls(page: Page) {
  const toolbar = page.getByRole('group', {
    name: 'Быстрые действия объекта',
    exact: true,
  });
  const settings = page.getByRole('group', {
    name: 'Поворот объекта',
    exact: true,
  });
  const clockwise = (group: Locator) =>
    group.getByRole('button', {
      name: 'Повернуть по часовой стрелке',
      exact: true,
    });
  const counterclockwise = (group: Locator) =>
    group.getByRole('button', {
      name: 'Повернуть против часовой стрелки',
      exact: true,
    });
  return {
    toolbar,
    settings,
    clockwise,
    counterclockwise,
    angle: page.getByLabel('Угол поворота', { exact: true }),
  };
}

async function itemGeometry(item: Locator) {
  return item.evaluate((element) => {
    const transform = element.getAttribute('transform')!;
    const translation = transform
      .match(/^translate\(([^)]+)\)/)![1]
      .split(/[\s,]+/)
      .map(Number);
    return {
      center: { x: translation[0], y: translation[1] },
      rotation: Number(transform.match(/rotate\(([^)]+)\)/)![1]),
      scale: Number(transform.match(/scale\(([^)]+)\)/)![1]),
      transform,
      artwork: element.querySelector('svg')!.outerHTML,
    };
  });
}

async function cornersOf(item: Locator) {
  return item
    .locator('svg')
    .first()
    .evaluate((element) => {
      if (!(element instanceof SVGSVGElement))
        throw new Error('Expected an SVG viewport.');
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error('Expected a screen transformation.');
      const { x, y, width, height } = element.viewBox.baseVal;
      return [
        new DOMPoint(x, y),
        new DOMPoint(x + width, y),
        new DOMPoint(x, y + height),
        new DOMPoint(x + width, y + height),
      ]
        .map((point) => point.matrixTransform(matrix))
        .map((point) => ({ x: point.x, y: point.y }));
    });
}

async function boundsOf(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Expected a visible control.');
  return bounds;
}

async function expectRotation(item: Locator, angle: Locator, value: number) {
  await expect(angle).toHaveText(`${value}°`);
  expect((await itemGeometry(item)).rotation).toBe(value);
}

test('rotation arrows in both locations preserve the selected object settings and export the resulting vector transform', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const add = page.getByRole('button', {
    name: 'Добавить: Кошелёк',
    exact: true,
  });
  await add.click();
  await add.click();
  const items = sceneSvg(page).locator('[data-item-id]');
  await expect(items).toHaveCount(2);
  const untouched = items.nth(0);
  const selected = items.nth(1);
  const selectedId = await selected.getAttribute('data-item-id');
  await page
    .getByRole('group', { name: 'Размер исходника объекта', exact: true })
    .getByRole('button', { name: 'S', exact: true })
    .click();
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Высота', exact: true });
  await width.fill('280');
  await width.press('Enter');
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 4', exact: true })
    .click();
  const original = await itemGeometry(selected);
  const untouchedBefore = await itemGeometry(untouched);
  const heightBefore = await height.inputValue();
  const orderBefore = await items.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-item-id')),
  );
  const { toolbar, settings, clockwise, counterclockwise, angle } =
    rotationControls(page);
  await expect(toolbar).toBeVisible();
  const boardBefore = await boundsOf(sceneSvg(page));
  await clockwise(toolbar).click();
  await expectRotation(selected, angle, 15);
  await counterclockwise(settings).click();
  await expectRotation(selected, angle, 0);
  await counterclockwise(toolbar).click();
  await expectRotation(selected, angle, 345);
  await clockwise(settings).click();
  await expectRotation(selected, angle, 0);
  for (let step = 0; step < 24; step += 1) await clockwise(toolbar).click();
  await expectRotation(selected, angle, 0);
  await clockwise(settings).click();
  await expectRotation(selected, angle, 15);
  const rotated = await itemGeometry(selected);
  expect(rotated.center).toEqual(original.center);
  expect(rotated.scale).toBe(original.scale);
  expect(rotated.artwork).toBe(original.artwork);
  expect(await itemGeometry(untouched)).toEqual(untouchedBefore);
  await expect(width).toHaveValue('280');
  await expect(height).toHaveValue(heightBefore);
  await expect(selected).toHaveAttribute('data-detail-size', 'S');
  expect(
    await items.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-item-id')),
    ),
  ).toEqual(orderBefore);
  await expect(
    page
      .locator(`li[data-layer-id="${selectedId}"]`)
      .getByRole('button', { name: /^Выбрать:/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await boundsOf(sceneSvg(page))).toEqual(boardBefore);
  expect(
    await page.evaluate(() => ({
      x: scrollX,
      y: scrollY,
      overflow: document.documentElement.scrollWidth > innerWidth,
    })),
  ).toEqual({ x: 0, y: 0, overflow: false });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Expected the downloaded composition.');
  const exported = await readFile(path, 'utf8');
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  expect(canonical(exported)).toBe(
    canonical(await sceneSvg(page).evaluate((svg) => svg.outerHTML)),
  );
  expect(exported).toContain('rotate(15)');
  expect(exported).not.toMatch(
    /object-layer-toolbar|data-resize-corner|<button|<image|foreignObject/,
  );
  await page.screenshot({
    path: testInfo.outputPath('rotation-desktop.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('rotated selection remains draggable and corner resizing fixes the opposite rotated corner', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const item = sceneSvg(page).locator('[data-item-id]');
  const { toolbar, clockwise, angle } = rotationControls(page);
  for (let step = 0; step < 3; step += 1) await clockwise(toolbar).click();
  await expectRotation(item, angle, 45);
  const initial = await itemGeometry(item);
  const initialCorners = await cornersOf(item);
  const center = {
    x: (initialCorners[0].x + initialCorners[3].x) / 2,
    y: (initialCorners[0].y + initialCorners[3].y) / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 36, center.y + 22, { steps: 8 });
  await page.mouse.up();
  const moved = await itemGeometry(item);
  const board = await boundsOf(sceneSvg(page));
  expect(moved.center.x - initial.center.x).toBeCloseTo(
    (36 * 1000) / board.width,
    3,
  );
  expect(moved.center.y - initial.center.y).toBeCloseTo(
    (22 * 1000) / board.height,
    3,
  );
  expect(moved.scale).toBe(initial.scale);
  await expectRotation(item, angle, 45);
  const before = await cornersOf(item);
  const handle = await boundsOf(page.locator('[data-resize-corner="se"]'));
  const start = {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2,
  };
  const delta = {
    x: (before[3].x - before[0].x) / 4,
    y: (before[3].y - before[0].y) / 4,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 });
  await page.mouse.up();
  const after = await cornersOf(item);
  expect(after[0].x).toBeCloseTo(before[0].x, 2);
  expect(after[0].y).toBeCloseTo(before[0].y, 2);
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  expect(
    distance(after[0], after[1]) / distance(before[0], before[1]),
  ).toBeCloseTo(1.25, 2);
  expect(
    distance(after[0], after[1]) / distance(after[0], after[2]),
  ).toBeCloseTo(631 / 397, 6);
  expect((await itemGeometry(item)).artwork).toBe(initial.artwork);
  await expectRotation(item, angle, 45);
  await expect(
    page.getByRole('spinbutton', { name: 'Ширина', exact: true }),
  ).toHaveValue('788.75');
  expect(errors).toEqual([]);
});

test.describe('touch rotation controls', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('both sets of arrows remain reachable without horizontal page overflow', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
      .tap();
    const item = sceneSvg(page).locator('[data-item-id]');
    const before = await itemGeometry(item);
    const { toolbar, settings, clockwise, counterclockwise, angle } =
      rotationControls(page);
    await clockwise(toolbar).tap();
    await expectRotation(item, angle, 15);
    await clockwise(settings).tap();
    await expectRotation(item, angle, 30);
    await counterclockwise(toolbar).tap();
    await expectRotation(item, angle, 15);
    await expect(page.locator('[data-resize-corner]')).toHaveCount(4);
    const after = await itemGeometry(item);
    expect(after.center).toEqual(before.center);
    expect(after.scale).toBe(before.scale);
    expect(after.artwork).toBe(before.artwork);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const toolbarBox = await boundsOf(toolbar);
    const canvasBox = await boundsOf(sceneSvg(page));
    expect(toolbarBox.x).toBeGreaterThanOrEqual(canvasBox.x);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(
      canvasBox.x + canvasBox.width,
    );
    await page.screenshot({
      path: testInfo.outputPath('rotation-mobile.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
});
