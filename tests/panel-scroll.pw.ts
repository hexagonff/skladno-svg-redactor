import { expect, test, type Locator, type Page } from '@playwright/test';

async function boundsOf(element: Locator) {
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error('Expected visible geometry.');
  return bounds;
}

async function expectStationary(
  element: Locator,
  before: Awaited<ReturnType<typeof boundsOf>>,
) {
  const after = await boundsOf(element);
  for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after[coordinate] - before[coordinate])).toBeLessThan(1);
  }
}

async function expectPageToFit(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
        horizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth,
        verticalOverflow:
          document.documentElement.scrollHeight > window.innerHeight + 1,
      })),
    )
    .toEqual({
      x: 0,
      y: 0,
      horizontalOverflow: false,
      verticalOverflow: false,
    });
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1024, height: 600 },
]) {
  test(`settings scroll independently without moving the canvas at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const addWallet = page.getByRole('button', {
      name: 'Добавить: Кошелёк',
      exact: true,
    });
    await expect(addWallet).toBeVisible();
    const canvas = page.locator('.artboard');
    const header = page.locator('.app-header');
    const settings = page.locator('.settings-panel');
    const canvasBefore = await boundsOf(canvas);
    const headerBefore = await boundsOf(header);
    await expectPageToFit(page);

    // Opening the color controls must not resize or recenter the artboard.
    await addWallet.click();
    await expect(
      page.getByText('Цвета объекта', { exact: true }),
    ).toBeVisible();
    await expectStationary(canvas, canvasBefore);
    await expectPageToFit(page);
    for (let index = 1; index < 16; index += 1) await addWallet.click();
    await expect(canvas.locator('[data-item-id]')).toHaveCount(16);
    await expect
      .poll(() =>
        settings.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      )
      .toBeGreaterThan(100);
    await expectStationary(canvas, canvasBefore);
    await expectPageToFit(page);

    const settingsBounds = await boundsOf(settings);
    const scrollBefore = await settings.evaluate(
      (element) => element.scrollTop,
    );
    await page.mouse.move(
      settingsBounds.x + settingsBounds.width / 2,
      settingsBounds.y + settingsBounds.height / 2,
    );
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => settings.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(scrollBefore);
    await expectStationary(canvas, canvasBefore);
    await expectStationary(header, headerBefore);
    await expectPageToFit(page);

    // The bottom layer remains reachable and keyboard selection does not scroll the page.
    const lastWallet = page.getByRole('button', {
      name: 'Выбрать: Кошелёк, 1',
      exact: true,
    });
    await lastWallet.scrollIntoViewIfNeeded();
    await lastWallet.focus();
    await page.keyboard.press('Enter');
    await expect(lastWallet).toBeInViewport();
    await expect(lastWallet).toHaveAttribute('aria-pressed', 'true');
    await expectPageToFit(page);

    // Scrolling past the menu's end must not pass scrolling to the document.
    const atBottom = await settings.evaluate((element) => element.scrollTop);
    await page.mouse.move(
      settingsBounds.x + settingsBounds.width / 2,
      settingsBounds.y + settingsBounds.height - 20,
    );
    await page.mouse.wheel(0, 2000);
    await expect
      .poll(() =>
        settings.evaluate(
          (element) =>
            element.scrollTop + element.clientHeight >=
            element.scrollHeight - 1,
        ),
      )
      .toBe(true);
    expect(
      await settings.evaluate((element) => element.scrollTop),
    ).toBeGreaterThanOrEqual(atBottom);
    await page.mouse.wheel(0, 2000);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expectPageToFit(page);
    await expectStationary(canvas, canvasBefore);
    await expectStationary(header, headerBefore);

    // Collapsing and reopening the main-object color controls cannot shift the centre.
    for (const role of ['Фоновый', 'Главный', 'Фоновый', 'Главный']) {
      await page.getByRole('button', { name: role, exact: true }).click();
      await expectStationary(canvas, canvasBefore);
      await expectPageToFit(page);
    }
    await expectStationary(header, headerBefore);
  });
}
