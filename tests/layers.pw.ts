import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function boundsOf(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Expected a visible layer control.');
  return bounds;
}

function sceneSvg(page: Page) {
  return page
    .getByLabel('Холст композиции', { exact: true })
    .locator(':scope > svg');
}

async function paintOrder(page: Page): Promise<string[]> {
  return sceneSvg(page)
    .locator('[data-item-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-item-id')!),
    );
}

async function expectLayers(page: Page, bottomToTop: string[]) {
  await expect.poll(() => paintOrder(page)).toEqual(bottomToTop);
  const rows = page.locator('li[data-layer-id]');
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-layer-id')),
      ),
    )
    .toEqual([...bottomToTop].reverse());
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-layer-order')),
      ),
    )
    .toEqual(bottomToTop.map((_, index) => String(bottomToTop.length - index)));
}

async function addWallets(page: Page, count: number) {
  const add = page.getByRole('button', {
    name: 'Добавить: Кошелёк',
    exact: true,
  });
  for (let index = 0; index < count; index += 1) await add.click();
  return paintOrder(page);
}

function rowFor(page: Page, id: string) {
  return page.locator(`li[data-layer-id="${id}"]`);
}

function gripFor(page: Page, id: string) {
  return rowFor(page, id).locator('[data-layer-drag-handle]');
}

async function dragLayer(
  page: Page,
  id: string,
  targetId: string,
  edge: 'top' | 'bottom',
) {
  const grip = gripFor(page, id);
  await grip.scrollIntoViewIfNeeded();
  const start = await boundsOf(grip);
  const target = await boundsOf(rowFor(page, targetId));
  const endY = edge === 'top' ? target.y + 2 : target.y + target.height - 2;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, endY, { steps: 10 });
  await page.mouse.up();
}

async function objectMarkup(page: Page) {
  return sceneSvg(page)
    .locator('[data-item-id]')
    .evaluateAll((items) =>
      Object.fromEntries(
        items.map((item) => [
          item.getAttribute('data-item-id')!,
          item.outerHTML,
        ]),
      ),
    );
}

async function sharedPaintPoint(page: Page, ids: string[]) {
  return sceneSvg(page).evaluate((svg, itemIds) => {
    const box = svg.getBoundingClientRect();
    for (let row = 5; row < 35; row += 1) {
      for (let column = 5; column < 35; column += 1) {
        const point = {
          x: box.x + (box.width * column) / 40,
          y: box.y + (box.height * row) / 40,
        };
        const hits = [
          ...new Set(
            document
              .elementsFromPoint(point.x, point.y)
              .map((element) =>
                element.closest('[data-item-id]')?.getAttribute('data-item-id'),
              )
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        if (itemIds.every((id) => hits.includes(id))) return point;
      }
    }
    throw new Error('Expected a painted overlap of every layer.');
  }, ids);
}

async function topPaintedAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(
    ({ x, y }) =>
      document
        .elementsFromPoint(x, y)
        .map((element) =>
          element.closest('[data-item-id]')?.getAttribute('data-item-id'),
        )
        .find(Boolean),
    point,
  );
}

async function exportSvg(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Expected the downloaded composition.');
  return readFile(path, 'utf8');
}

test('layer drag, arrows and numeric order change actual SVG overlap while retaining object settings and export', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const ids = await addWallets(page, 3);
  const [bottom, middle, top] = ids as [string, string, string];
  await page
    .getByRole('group', { name: 'Детализация объекта', exact: true })
    .getByRole('button', { name: 'S', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 4', exact: true })
    .click();
  const before = await objectMarkup(page);
  const overlap = await sharedPaintPoint(page, ids);
  await expectLayers(page, ids);
  expect(await topPaintedAt(page, overlap)).toBe(top);
  const layer = page.getByRole('spinbutton', {
    name: 'Порядок слоя',
    exact: true,
  });
  const up = page.getByRole('button', { name: 'На слой выше', exact: true });
  const down = page.getByRole('button', { name: 'На слой ниже', exact: true });
  await expect(layer).toHaveValue('3');
  await expect(up).toBeDisabled();
  await expect(down).toBeEnabled();

  await dragLayer(page, bottom, top, 'top');
  await expectLayers(page, [middle, top, bottom]);
  await expect(
    rowFor(page, bottom).getByRole('button', { name: /^Выбрать:/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(layer).toHaveValue('3');
  expect(await topPaintedAt(page, overlap)).toBe(bottom);
  expect(await objectMarkup(page)).toEqual(before);

  await down.click();
  await expectLayers(page, [middle, bottom, top]);
  await expect(layer).toHaveValue('2');
  await expect(up).toBeEnabled();
  expect(await topPaintedAt(page, overlap)).toBe(top);
  await up.click();
  await expectLayers(page, [middle, top, bottom]);
  await expect(layer).toHaveValue('3');
  await layer.fill('1');
  await layer.press('Enter');
  await expectLayers(page, [bottom, middle, top]);
  await expect(down).toBeDisabled();
  await expect(up).toBeEnabled();
  await expect(layer).toHaveValue('1');
  await layer.fill('0');
  await layer.press('Enter');
  await expect(layer).toHaveValue('1');
  await layer.fill('4');
  await layer.press('Tab');
  await expect(layer).toHaveValue('1');
  await layer.fill('1.5');
  await layer.press('Enter');
  await expect(layer).toHaveValue('1');
  await layer.fill('');
  await layer.press('Tab');
  await expect(layer).toHaveValue('1');
  await expectLayers(page, ids);
  expect(await objectMarkup(page)).toEqual(before);

  // A typed direct jump must also commit on blur, with the selection following its ID.
  await layer.fill('3');
  await layer.press('Tab');
  await expectLayers(page, [middle, top, bottom]);
  await expect(
    rowFor(page, bottom).getByRole('button', { name: /^Выбрать:/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.object-layer-toolbar')).toContainText('3');
  const exported = await exportSvg(page);
  const document = new DOMParser().parseFromString(exported, 'image/svg+xml');
  const groups = Array.from(document.getElementsByTagName('g'));
  expect(
    groups
      .filter((group) => group.hasAttribute('data-item-id'))
      .map((group) => group.getAttribute('data-item-id')),
  ).toEqual([middle, top, bottom]);
  expect(groups[0]!.getAttribute('data-canvas-id')).toBe('canvas1');
  expect(exported).not.toMatch(
    /object-layer-toolbar|data-layer-drag-handle|resize-corner|<button|z-index/,
  );
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  expect(canonical(exported)).toBe(
    canonical(await sceneSvg(page).evaluate((svg) => svg.outerHTML)),
  );

  await page
    .getByRole('button', { name: 'Удалить выбранный', exact: true })
    .click();
  await expectLayers(page, [middle, top]);
  await rowFor(page, top)
    .getByRole('button', { name: /^Выбрать:/ })
    .click();
  await expect(layer).toHaveValue('2');
  await expect(
    page
      .getByRole('group', { name: 'Детализация объекта', exact: true })
      .getByRole('button', { name: 'S', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    sceneSvg(page).locator(`[data-item-id="${top}"] path`).first(),
  ).toHaveAttribute('fill', '#F9ECB0');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const afterAdd = await paintOrder(page);
  expect(afterAdd.slice(0, 2)).toEqual([middle, top]);
  expect(ids).not.toContain(afterAdd[2]);
  await expectLayers(page, afterAdd);
  await expect(layer).toHaveValue('3');
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('layers-desktop.png'),
    fullPage: true,
  });
});

test('keyboard reorders the focused grip one layer at a time and respects both boundaries', async ({
  page,
}) => {
  await page.goto('/');
  const ids = await addWallets(page, 3);
  const [bottom, middle, top] = ids as [string, string, string];
  const grip = gripFor(page, bottom);
  await grip.focus();
  await grip.press('ArrowDown');
  await expectLayers(page, ids);
  await grip.press('ArrowUp');
  await expectLayers(page, [middle, bottom, top]);
  await expect(grip).toBeFocused();
  await expect(
    page.getByRole('spinbutton', { name: 'Порядок слоя', exact: true }),
  ).toHaveValue('2');
  await grip.press('ArrowUp');
  await expectLayers(page, [middle, top, bottom]);
  await expect(grip).toBeFocused();
  await grip.press('ArrowUp');
  await expectLayers(page, [middle, top, bottom]);
  await grip.press('ArrowDown');
  await expectLayers(page, [middle, bottom, top]);
  await expect(grip).toBeFocused();
});

test('dragging a layer at the panel edge scrolls the list without moving the canvas or the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/');
  const ids = await addWallets(page, 16);
  const top = ids.at(-1)!;
  const settings = page.locator('.settings-panel');
  const canvas = sceneSvg(page);
  const canvasBefore = await boundsOf(canvas);
  const grip = gripFor(page, top);
  await grip.scrollIntoViewIfNeeded();
  const start = await boundsOf(grip);
  const panel = await boundsOf(settings);
  const scrollBefore = await settings.evaluate((element) => element.scrollTop);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2,
    panel.y + panel.height - 10,
    { steps: 10 },
  );
  await expect
    .poll(() => settings.evaluate((element) => element.scrollTop), {
      timeout: 5000,
    })
    .toBeGreaterThan(scrollBefore + 150);
  await page.mouse.up();
  const after = await paintOrder(page);
  expect(after.indexOf(top)).toBeLessThan(15);
  await expectLayers(page, after);
  expect(await boundsOf(canvas)).toEqual(canvasBefore);
  expect(
    await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
  ).toEqual({ x: 0, y: 0 });
});

test.describe('touch layer reordering', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('touch grip changes order and cancellation leaves it unchanged', async ({
    page,
  }) => {
    await page.goto('/');
    const ids = await addWallets(page, 3);
    const [bottom, middle, top] = ids as [string, string, string];
    const grip = gripFor(page, bottom);
    await grip.scrollIntoViewIfNeeded();
    const start = await boundsOf(grip);
    const target = await boundsOf(rowFor(page, top));
    const point = {
      x: start.x + start.width / 2,
      y: start.y + start.height / 2,
      id: 1,
    };
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { ...point, y: point.y + ((target.y + 2 - point.y) * step) / 8 },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expectLayers(page, [middle, top, bottom]);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await grip.scrollIntoViewIfNeeded();
    const moved = await boundsOf(grip);
    const nextPoint = {
      x: moved.x + moved.width / 2,
      y: moved.y + moved.height / 2,
      id: 2,
    };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [nextPoint],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...nextPoint, y: nextPoint.y + 50 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    await expectLayers(page, [middle, top, bottom]);
    await rowFor(page, top)
      .getByRole('button', { name: /^Выбрать:/ })
      .click();
    await expect(
      page.getByRole('spinbutton', { name: 'Порядок слоя', exact: true }),
    ).toHaveValue('2');
    await cdp.detach();
  });
});
