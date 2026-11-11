import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { svgViewportBounds } from './svgViewport';

async function boundsOf(element: Locator) {
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error('Expected visible geometry.');
  return bounds;
}

async function sourceFrame(item: Locator) {
  return svgViewportBounds(item.locator('svg').first());
}

async function sceneSize(item: Locator, canvas: Locator) {
  const frame = await sourceFrame(item);
  const board = await boundsOf(canvas.locator('svg').first());
  return {
    width: (frame.width * 1000) / board.width,
    height: (frame.height * 1000) / board.height,
  };
}

async function expectDimension(input: Locator, value: number) {
  await expect
    .poll(async () => Number(await input.inputValue()))
    .toBeCloseTo(value, 2);
}

async function dragCorner(page: Page, corner: string, dx: number, dy: number) {
  const handle = page.locator(`[data-resize-corner="${corner}"]`);
  const box = await boundsOf(handle);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('manual dimensions preserve proportions and affect only the selected object', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const addWallet = page.getByRole('button', {
    name: 'Добавить: Кошелёк',
    exact: true,
  });
  await addWallet.click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const firstId = await canvas
    .locator('[data-item-id]')
    .getAttribute('data-item-id');
  const first = canvas.locator(`[data-item-id="${firstId}"]`);
  const originalTransform = await first.getAttribute('transform');
  const originalPaints = await first
    .locator('path')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('fill')));
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Высота', exact: true });
  const detail = page.getByRole('group', {
    name: 'Детализация объекта',
    exact: true,
  });
  await expect(
    page.getByRole('group', { name: 'Размер объекта', exact: true }),
  ).toBeVisible();
  await expectDimension(width, 220.85);
  await expectDimension(height, 138.95);
  expect((await sceneSize(first, canvas)).width).toBeCloseTo(220.85, 3);

  await addWallet.click();
  const second = canvas.locator('[data-item-id]').nth(1);
  const secondFrame = await sourceFrame(second);
  const secondTransform = await second.getAttribute('transform');
  await page
    .getByRole('button', { name: 'Выбрать: Кошелёк, 1', exact: true })
    .click();

  await width.fill('400');
  await width.press('Enter');
  await expectDimension(width, 400);
  await expectDimension(height, (400 * 397) / 631);
  let dimensions = await sceneSize(first, canvas);
  expect(dimensions.width).toBeCloseTo(400, 3);
  expect(dimensions.width / dimensions.height).toBeCloseTo(631 / 397, 6);

  await height.fill('200');
  await height.press('Tab');
  const resizedWidth = (200 * 631) / 397;
  await expectDimension(width, resizedWidth);
  dimensions = await sceneSize(first, canvas);
  expect(dimensions.height).toBeCloseTo(200, 3);
  expect(dimensions.width).toBeCloseTo(resizedWidth, 3);
  expect((await first.getAttribute('transform'))!.split(' scale(')[0]).toBe(
    originalTransform!.split(' scale(')[0],
  );
  expect(
    await first
      .locator('path')
      .evaluateAll((paths) => paths.map((path) => path.getAttribute('fill'))),
  ).toEqual(originalPaints);
  expect(await sourceFrame(second)).toEqual(secondFrame);
  expect(await second.getAttribute('transform')).toBe(secondTransform);

  // Invalid drafts cannot put zero, negative or non-finite dimensions into the scene.
  const validTransform = await first.getAttribute('transform');
  for (const invalid of ['0', '-12', '']) {
    await width.fill(invalid);
    await width.press('Tab');
    expect(await first.getAttribute('transform')).toBe(validTransform);
    await expectDimension(width, resizedWidth);
  }
  await detail.getByRole('button', { name: 'S', exact: true }).click();
  await expect(first).toHaveAttribute('data-detail-size', 'S');
  await expect(second).toHaveAttribute('data-detail-size', 'L');
  dimensions = await sceneSize(first, canvas);
  expect(dimensions.width).toBeCloseTo(resizedWidth, 3);
  expect(dimensions.width / dimensions.height).toBeCloseTo(316 / 199, 6);
  await expectDimension(width, resizedWidth);
  await expectDimension(height, (resizedWidth * 199) / 316);

  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  await width.fill('280');
  await width.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Фоновый', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('orange');
  await expectDimension(width, 280);
  expect((await sceneSize(first, canvas)).width).toBeCloseTo(280, 3);
  expect(await second.getAttribute('transform')).toBe(secondTransform);
  await detail.getByRole('button', { name: 'L', exact: true }).click();
  expect((await sceneSize(first, canvas)).width).toBeCloseTo(280, 3);
  expect((await first.getAttribute('transform'))!.split(' scale(')[0]).toBe(
    originalTransform!.split(' scale(')[0],
  );
  expect(errors).toEqual([]);
});

test('corner resizing keeps the opposite corner fixed and exports only the artwork', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const item = canvas.locator('[data-item-id]');
  const handles = page.locator('[data-resize-corner]');
  await expect(handles).toHaveCount(4);
  await expect(
    page.getByRole('button', {
      name: 'Изменить размер: нижний правый угол',
      exact: true,
    }),
  ).toBeVisible();
  await expect(canvas.locator('.object-selection')).toHaveCount(0);
  const before = await sourceFrame(item);
  await dragCorner(page, 'se', 1, 1);
  const tiny = await sourceFrame(item);
  expect(tiny.x).toBeCloseTo(before.x, 3);
  expect(tiny.y).toBeCloseTo(before.y, 3);
  expect(tiny.width).toBeCloseTo(before.width, 3);

  await dragCorner(page, 'se', 55, 35);
  const grown = await sourceFrame(item);
  expect(grown.width).toBeGreaterThan(before.width + 30);
  expect(grown.width / grown.height).toBeCloseTo(631 / 397, 6);
  expect(Math.abs(grown.x - before.x)).toBeLessThan(1);
  expect(Math.abs(grown.y - before.y)).toBeLessThan(1);
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Высота', exact: true });
  const dimensions = await sceneSize(item, canvas);
  await expectDimension(width, dimensions.width);
  await expectDimension(height, dimensions.height);

  await dragCorner(page, 'se', -25, -16);
  const shrunk = await sourceFrame(item);
  expect(shrunk.width).toBeLessThan(grown.width - 15);
  expect(Math.abs(shrunk.x - before.x)).toBeLessThan(1);
  expect(Math.abs(shrunk.y - before.y)).toBeLessThan(1);
  expect(shrunk.width / shrunk.height).toBeCloseTo(631 / 397, 6);
  // The opposite diagonal handle follows the same proportional rule.
  await dragCorner(page, 'nw', -30, -20);
  const fromTopLeft = await sourceFrame(item);
  expect(fromTopLeft.width).toBeGreaterThan(shrunk.width + 15);
  expect(
    Math.abs(fromTopLeft.x + fromTopLeft.width - shrunk.x - shrunk.width),
  ).toBeLessThan(1);
  expect(
    Math.abs(fromTopLeft.y + fromTopLeft.height - shrunk.y - shrunk.height),
  ).toBeLessThan(1);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const filename = await (await download).path();
  expect(filename).not.toBeNull();
  const exported = await readFile(filename!, 'utf8');
  expect(exported).not.toMatch(/object-selection|resize-corner|<button/);
  const document = new DOMParser().parseFromString(exported, 'image/svg+xml');
  expect(document.getElementsByTagName('image')).toHaveLength(0);
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  const screen = await canvas
    .locator('svg')
    .first()
    .evaluate((svg) => svg.outerHTML);
  expect(canonical(exported)).toBe(canonical(screen));
  expect(errors).toEqual([]);
});

test.describe('touch resizing', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('resizes without scrolling and recovers from cancellation and deletion', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
      .click();
    const canvas = page.getByLabel('Холст композиции', { exact: true });
    const item = canvas.locator('[data-item-id]');
    await canvas.scrollIntoViewIfNeeded();
    const before = await sourceFrame(item);
    const handle = page.locator('[data-resize-corner="se"]');
    const box = await boundsOf(handle);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scrollY = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: start.x + (35 * step) / 6, y: start.y + (22 * step) / 6, id: 1 },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    const grown = await sourceFrame(item);
    expect(grown.width).toBeGreaterThan(before.width + 20);
    expect(grown.width / grown.height).toBeCloseTo(631 / 397, 6);
    expect(Math.abs(grown.x - before.x)).toBeLessThan(1);
    expect(Math.abs(grown.y - before.y)).toBeLessThan(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    const handleAfter = await boundsOf(handle);
    const next = {
      x: handleAfter.x + handleAfter.width / 2,
      y: handleAfter.y + handleAfter.height / 2,
    };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...next, id: 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    expect(await sourceFrame(item)).toEqual(grown);
    await dragCorner(page, 'se', -15, -10);
    expect((await sourceFrame(item)).width).toBeLessThan(grown.width - 8);

    // Deleting during captured resize ends the gesture before later pointer events.
    const lastHandle = await boundsOf(handle);
    await page.mouse.move(
      lastHandle.x + lastHandle.width / 2,
      lastHandle.y + lastHandle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      lastHandle.x + lastHandle.width / 2 + 10,
      lastHandle.y + lastHandle.height / 2 + 7,
    );
    const remove = page.getByRole('button', {
      name: 'Удалить выбранный',
      exact: true,
    });
    await remove.focus();
    await page.keyboard.press('Enter');
    await page.mouse.up();
    await expect(canvas.locator('[data-item-id]')).toHaveCount(0);
    await expect(page.locator('[data-resize-corner]')).toHaveCount(0);
    await expect(remove).toBeDisabled();
    await page
      .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
      .click();
    await canvas.scrollIntoViewIfNeeded();
    await dragCorner(page, 'se', 15, 10);
    expect(
      (await sourceFrame(canvas.locator('[data-item-id]'))).width,
    ).toBeGreaterThan(before.width + 8);
    expect(errors).toEqual([]);
    await cdp.detach();
  });
});
