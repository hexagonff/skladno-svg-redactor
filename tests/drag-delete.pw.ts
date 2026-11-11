import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { svgViewportBounds } from './svgViewport';

type Position = { x: number; y: number };

function positionFromTransform(transform: string): Position {
  const match = /^translate\(([-+\d.eE]+)[ ,]+([-+\d.eE]+)\)/.exec(transform);
  if (!match) throw new Error(`Missing item position: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function positionOf(item: Locator): Promise<Position> {
  return positionFromTransform((await item.getAttribute('transform')) ?? '');
}

async function boundsOf(item: Locator) {
  const box = await item.boundingBox();
  if (!box) throw new Error('Expected visible geometry.');
  return box;
}

async function downloadedSvg(page: Page): Promise<string> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const file = await (await event).path();
  if (!file) throw new Error('SVG was not downloaded.');
  return readFile(file, 'utf8');
}

test('drag preserves the grab offset and export; deleting removes only the selected instance', async ({
  page,
}) => {
  await page.goto('/');
  const remove = page.getByRole('button', {
    name: 'Удалить выбранный',
    exact: true,
  });
  await expect(remove).toBeDisabled();
  const addBook = page.getByRole('button', {
    name: 'Добавить: Книга',
    exact: true,
  });
  await addBook.click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const item = canvas.locator('[data-item-id]');
  const firstId = await item.getAttribute('data-item-id');
  const before = await boundsOf(item);
  const artboard = await boundsOf(canvas.locator('svg').first());
  const pose = await positionOf(item);
  const largeBounds = await svgViewportBounds(item.locator('svg').first());
  // Grab a point off centre so a snap-to-pointer implementation cannot pass.
  const start = {
    x: before.x + before.width * 0.6,
    y: before.y + before.height * 0.5,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y - 35, { steps: 8 });
  await page.mouse.up();
  const after = await boundsOf(item);
  expect(Math.abs(after.x - before.x - 60)).toBeLessThan(1.5);
  expect(Math.abs(after.y - before.y + 35)).toBeLessThan(1.5);
  expect(Math.abs(after.width - before.width)).toBeLessThan(0.1);
  expect(Math.abs(after.height - before.height)).toBeLessThan(0.1);
  const moved = await positionOf(item);
  expect(
    Math.abs(moved.x - pose.x - (60 * 1000) / artboard.width),
  ).toBeLessThan(2);
  expect(
    Math.abs(moved.y - pose.y + (35 * 1000) / artboard.height),
  ).toBeLessThan(2);
  await expect(
    page.getByRole('button', { name: 'Выбрать: Книга, 1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('group', { name: 'Размер исходника объекта', exact: true })
    .getByRole('button', { name: 'S', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('orange');
  expect(await positionOf(item)).toEqual(moved);
  const smallBounds = await svgViewportBounds(item.locator('svg').first());
  expect(smallBounds.width / largeBounds.width).toBeCloseTo(0.5, 4);
  expect(smallBounds.height / largeBounds.height).toBeCloseTo(489 / 977, 4);
  const exported = new DOMParser().parseFromString(
    await downloadedSvg(page),
    'image/svg+xml',
  );
  const exportedItem = Array.from(exported.getElementsByTagName('g')).find(
    (group) => group.getAttribute('data-item-id') === firstId,
  );
  expect(exportedItem).toBeDefined();
  expect(
    positionFromTransform(exportedItem!.getAttribute('transform')!),
  ).toEqual(moved);

  await addBook.click();
  const ids = await canvas
    .locator('[data-item-id]')
    .evaluateAll((items) =>
      items.map((entry) => entry.getAttribute('data-item-id')),
    );
  expect(ids).toHaveLength(2);
  await remove.click();
  await expect(canvas.locator('[data-item-id]')).toHaveCount(1);
  await expect(canvas.locator('[data-item-id]')).toHaveAttribute(
    'data-item-id',
    firstId!,
  );
  await expect(remove).toBeDisabled();
  expect(await positionOf(canvas.locator('[data-item-id]'))).toEqual(moved);
  await page
    .getByRole('button', { name: 'Выбрать: Книга, 1', exact: true })
    .click();
  await remove.click();
  await expect(canvas.locator('[data-item-id]')).toHaveCount(0);
  await expect(canvas.locator('[data-canvas-id]')).toHaveCount(1);
  expect(await downloadedSvg(page)).not.toContain('data-item-id');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await addBook.click();
  expect(ids).not.toContain(
    await canvas.locator('[data-item-id]').getAttribute('data-item-id'),
  );
});

test('capture survives leaving the canvas and deletion safely ends an active gesture', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const addBook = page.getByRole('button', {
    name: 'Добавить: Книга',
    exact: true,
  });
  await addBook.click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const first = canvas.locator('[data-item-id]').first();
  const box = await boundsOf(first);
  const board = await boundsOf(canvas.locator('svg').first());
  const start = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width + 80, start.y, { steps: 12 });
  await page.mouse.up();
  const outside = await positionOf(first);
  expect(outside.x).toBeGreaterThan(900);
  await expect(
    page.getByRole('button', { name: 'Выбрать: Книга, 1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(board.x + 15, board.y + 15);
  expect(await positionOf(first)).toEqual(outside);

  await addBook.click();
  const second = canvas.locator('[data-item-id]').nth(1);
  const secondBox = await boundsOf(second);
  await page.mouse.move(
    secondBox.x + secondBox.width * 0.6,
    secondBox.y + secondBox.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width * 0.6 + 25,
    secondBox.y + secondBox.height * 0.5 + 20,
    { steps: 4 },
  );
  // Keyboard activation can remove a selected object while a pointer is captured.
  const remove = page.getByRole('button', {
    name: 'Удалить выбранный',
    exact: true,
  });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(canvas.locator('[data-item-id]')).toHaveCount(1);
  await page.mouse.move(board.x + 10, board.y + 10);
  await page.mouse.up();
  await expect(remove).toBeDisabled();
  expect(await positionOf(first)).toEqual(outside);
  expect(errors).toEqual([]);
});

test.describe('touch dragging', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('moves in SVG coordinates without scrolling and recovers after pointer cancellation', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Добавить: Книга', exact: true })
      .click();
    await page
      .getByRole('group', { name: 'Размер исходника объекта', exact: true })
      .getByRole('button', { name: 'S', exact: true })
      .click();
    const canvas = page.getByLabel('Холст композиции', { exact: true });
    await canvas.scrollIntoViewIfNeeded();
    const item = canvas.locator('[data-item-id]');
    const before = await boundsOf(item);
    const start = {
      x: before.x + before.width * 0.6,
      y: before.y + before.height * 0.5,
    };
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
          { x: start.x + (40 * step) / 6, y: start.y + (30 * step) / 6, id: 1 },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    const after = await boundsOf(item);
    expect(Math.abs(after.x - before.x - 40)).toBeLessThan(1.5);
    expect(Math.abs(after.y - before.y - 30)).toBeLessThan(1.5);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    const moved = await positionOf(item);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        {
          x: after.x + after.width * 0.6,
          y: after.y + after.height * 0.5,
          id: 2,
        },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    expect(await positionOf(item)).toEqual(moved);
    // A fresh touch after cancellation can still select the object.
    await page
      .getByRole('button', { name: 'Выбрать: Книга, 1', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Удалить выбранный', exact: true }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
    await cdp.detach();
  });
});
