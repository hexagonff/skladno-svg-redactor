import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test } from '@playwright/test';
import { svgViewportBounds } from './svgViewport';

function expectStandaloneSvg(svg: string): void {
  expect(svg).not.toMatch(/var\s*\(/i);
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement!;
  expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(root.getAttribute('viewBox')).toBe('0 0 1000 1000');
  for (const name of ['image', 'foreignObject', 'style']) {
    expect(document.getElementsByTagName(name).length).toBe(0);
  }
  const elements = Array.from(document.getElementsByTagName('*'));
  const ids = elements
    .filter((element) => element.hasAttribute('id'))
    .map((element) => element.getAttribute('id'));
  expect(new Set(ids).size).toBe(ids.length);
  for (const element of elements) {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const value = element.attributes.item(index)!.value;
      for (const match of value.matchAll(/url\(#([^)]+)\)/g)) {
        expect(ids).toContain(match[1]);
      }
    }
  }
}

test('library to scene, object detail, palette, role and editable SVG download', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  await expect(canvas.locator('svg').first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Добавить: Книга', exact: true })
    .click();
  const item = canvas.locator('[data-item-id]');
  await expect(item).toHaveCount(1);
  await expect(item.locator('path')).toHaveCount(53);
  const originalBounds = await svgViewportBounds(item.locator('svg').first());

  await page
    .getByRole('group', { name: 'Размер исходника объекта', exact: true })
    .getByRole('button', { name: 'S', exact: true })
    .click();
  await expect(item.locator('path')).toHaveCount(51);
  await expect(canvas.locator('[data-canvas-id]')).toHaveAttribute(
    'data-detail-size',
    'L',
  );
  const smallBounds = await svgViewportBounds(item.locator('svg').first());
  expect(originalBounds).not.toBeNull();
  expect(smallBounds).not.toBeNull();
  expect(smallBounds!.width / originalBounds!.width).toBeCloseTo(0.5, 4);
  expect(smallBounds!.height / originalBounds!.height).toBeCloseTo(
    489 / 977,
    4,
  );

  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('orange');
  await expect(canvas.locator('[data-canvas-id]')).toHaveAttribute(
    'data-canvas-id',
    'canvas1',
  );
  await page
    .getByRole('combobox', { name: 'Фон', exact: true })
    .selectOption('canvas2');
  await expect(canvas.locator('[data-canvas-id]')).toHaveAttribute(
    'data-canvas-id',
    'canvas2',
  );
  await expect(canvas.locator('clipPath rect')).toHaveAttribute(
    'fill',
    'white',
  );
  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  const paints = await item
    .locator('path')
    .evaluateAll((paths) =>
      [...new Set(paths.map((path) => path.getAttribute('fill')))].sort(),
    );
  expect(paints).toEqual(['#D27532', '#FDD7B9']);
  await page
    .getByRole('group', { name: 'Размер исходника объекта', exact: true })
    .getByRole('button', { name: 'L', exact: true })
    .click();
  await expect(item.locator('path')).toHaveCount(53);
  await expect(
    page.getByRole('button', { name: 'Фоновый', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('skladno.svg');
  const filename = await download.path();
  expect(filename).not.toBeNull();
  const exported = await readFile(filename!, 'utf8');
  expectStandaloneSvg(exported);
  // The exported artwork is the same literal-color SVG shown on screen.
  const browserSvg = await canvas
    .locator('svg')
    .first()
    .evaluate((svg) => svg.outerHTML);
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  expect(canonical(exported)).toBe(canonical(browserSvg));
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('desktop.png'),
    fullPage: true,
  });
});

test('all catalogue objects render in their individual detail levels', async ({
  page,
}) => {
  await page.goto('/');
  const addButtons = page.getByRole('button', { name: /^Добавить:/ });
  for (let index = 0; index < 10; index += 1)
    await addButtons.nth(index).click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  await expect(canvas.locator('[data-item-id]')).toHaveCount(10);
  await expect(canvas.locator('[data-asset-id="phone"] path')).toHaveCount(155);
  const objectChoices = page.getByRole('button', { name: /^Выбрать:/ });
  for (let index = 0; index < 10; index += 1) {
    await objectChoices.nth(index).click();
    await page
      .getByRole('group', { name: 'Размер исходника объекта', exact: true })
      .getByRole('button', { name: 'S', exact: true })
      .click();
  }
  await expect(canvas.locator('[data-asset-id="phone"] path')).toHaveCount(96);
  await expect(
    canvas.locator('[data-item-id][data-detail-size="S"]'),
  ).toHaveCount(10);
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('teal');
  await expect(canvas.locator('[data-canvas-id]')).toHaveAttribute(
    'data-canvas-id',
    'canvas1',
  );
  const svg = await canvas
    .locator('svg')
    .first()
    .evaluate((element) => element.outerHTML);
  expectStandaloneSvg(svg);
});

test('narrow screen stays usable and repeated objects remain selectable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Телефон', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Добавить: Телефон', exact: true })
    .click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const items = canvas.locator('[data-item-id]');
  await expect(items).toHaveCount(2);
  const ids = await items.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-item-id')),
  );
  expect(new Set(ids).size).toBe(2);
  const firstChoice = page.getByRole('button', {
    name: 'Выбрать: Телефон, 1',
    exact: true,
  });
  const secondChoice = page.getByRole('button', {
    name: 'Выбрать: Телефон, 2',
    exact: true,
  });
  await firstChoice.click();
  await expect(firstChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(secondChoice).toHaveAttribute('aria-pressed', 'false');
  await items.nth(1).click();
  await expect(secondChoice).toHaveAttribute('aria-pressed', 'true');
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(firstChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(secondChoice).toHaveAttribute('aria-pressed', 'false');
  await firstChoice.focus();
  await page.keyboard.press('Enter');
  await expect(firstChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Скачать SVG', exact: true }),
  ).toBeEnabled();
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fitsViewport).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('mobile.png'),
    fullPage: true,
  });
});

test('catalogue loading error can be retried', async ({ page }) => {
  const catalogueRequest = '**/*manifest*.json*';
  await page.route(catalogueRequest, async (route) => {
    if (route.request().resourceType() === 'fetch') await route.abort('failed');
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute(catalogueRequest);
  await page.getByRole('button', { name: /Повторить/ }).click();
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await expect(
    page.getByLabel('Холст композиции', { exact: true }).locator('svg').first(),
  ).toBeVisible();
});
