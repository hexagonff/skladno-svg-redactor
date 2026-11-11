import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function bodyColor(item: Locator): Promise<string | null> {
  return item.locator('path').first().getAttribute('fill');
}

async function paintCounts(item: Locator): Promise<Record<string, number>> {
  return item.locator('path').evaluateAll((paths) => {
    const counts: Record<string, number> = {};
    for (const path of paths) {
      const fill = path.getAttribute('fill');
      if (fill) counts[fill] = (counts[fill] ?? 0) + 1;
    }
    return counts;
  });
}

async function geometryOf(item: Locator): Promise<string> {
  return item.evaluate((element) =>
    JSON.stringify(
      [element, ...element.querySelectorAll('*')].map((node) => ({
        tag: node.tagName,
        attributes: [...node.attributes]
          .filter(({ name }) => !['fill', 'stroke', 'style'].includes(name))
          .map(({ name, value }) => [name, value])
          .sort(([first], [second]) => first!.localeCompare(second!)),
      })),
    ),
  );
}

async function chooseColor(page: Page, source: number, target: number) {
  const sources = page.getByRole('group', {
    name: 'Используемые цвета',
    exact: true,
  });
  const targets = page.getByRole('group', {
    name: 'Заменить на:',
    exact: true,
  });
  await sources
    .getByRole('button', { name: `Участок ${source}`, exact: true })
    .click();
  await targets
    .getByRole('button', { name: `Цвет ${target}`, exact: true })
    .click();
  await expect(
    sources.getByRole('button', { name: `Участок ${source}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    targets.getByRole('button', { name: `Цвет ${target}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
}

async function downloadedSvg(page: Page): Promise<string> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const filename = await (await event).path();
  if (!filename) throw new Error('SVG was not downloaded.');
  return readFile(filename, 'utf8');
}

test('wallet recoloring affects one instance and follows its palette in both sizes and export', async ({
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
  const wallets = canvas.locator('[data-item-id][data-asset-id="wallet"]');
  await expect(wallets).toHaveCount(1);
  const firstId = await wallets.first().getAttribute('data-item-id');
  const first = canvas.locator(`[data-item-id="${firstId}"]`);
  const originalGeometry = await geometryOf(first);
  const originalPaints = await paintCounts(first);
  expect(await bodyColor(first)).toBe('#D7CDF5');
  expect(originalPaints['#181817']).toBeGreaterThan(0);
  expect(originalPaints['#FFFFFF']).toBeGreaterThan(0);
  await expect(page.getByText('Цвета объекта', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Выберите участок по его цвету, затем новый оттенок.', {
      exact: true,
    }),
  ).toBeVisible();
  const reset = page.getByRole('button', {
    name: 'Сбросить цвета',
    exact: true,
  });
  await expect(reset).toBeDisabled();
  const targets = page.getByRole('group', {
    name: 'Заменить на:',
    exact: true,
  });
  await expect(targets.getByRole('button')).toHaveCount(6);
  await chooseColor(page, 1, 4);
  await expect(reset).toBeEnabled();
  expect(await bodyColor(first)).toBe('#F9ECB0');
  const recoloredPaints = await paintCounts(first);
  expect(recoloredPaints['#D7CDF5']).toBeUndefined();
  expect(recoloredPaints['#F9ECB0']).toBe(
    originalPaints['#D7CDF5']! + originalPaints['#F9ECB0']!,
  );
  expect(recoloredPaints['#181817']).toBe(originalPaints['#181817']);
  expect(recoloredPaints['#FFFFFF']).toBe(originalPaints['#FFFFFF']);
  expect(await geometryOf(first)).toBe(originalGeometry);
  await expect(canvas.locator('[data-canvas-id] rect').first()).toHaveAttribute(
    'fill',
    '#D7CDF5',
  );

  await addWallet.click();
  await expect(wallets).toHaveCount(2);
  const secondId = await wallets.nth(1).getAttribute('data-item-id');
  const second = canvas.locator(`[data-item-id="${secondId}"]`);
  expect(await bodyColor(second)).toBe('#D7CDF5');
  expect(await bodyColor(first)).toBe('#F9ECB0');
  await expect(reset).toBeDisabled();
  await page
    .getByRole('button', { name: 'Выбрать: Кошелёк, 1', exact: true })
    .click();
  await expect(reset).toBeEnabled();
  await expect(
    targets.getByRole('button', { name: 'Цвет 4', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('teal');
  expect(await bodyColor(first)).toBe('#FFD4F2');
  expect(await bodyColor(second)).toBe('#BEEBEB');
  await expect(canvas.locator('[data-canvas-id] rect').first()).toHaveAttribute(
    'fill',
    '#BEEBEB',
  );
  expect(await geometryOf(first)).toBe(originalGeometry);
  await page
    .getByRole('group', { name: 'Размер исходника объекта', exact: true })
    .getByRole('button', { name: 'S', exact: true })
    .click();
  await expect(first).toHaveAttribute('data-detail-size', 'S');
  await expect(second).toHaveAttribute('data-detail-size', 'L');
  await expect(first.locator('path')).toHaveCount(83);
  expect(await bodyColor(first)).toBe('#FFD4F2');
  expect(await bodyColor(second)).toBe('#BEEBEB');
  const smallPaints = await paintCounts(first);
  expect(smallPaints['#181817']).toBeGreaterThan(0);
  expect(smallPaints['#FFFFFF']).toBe(originalPaints['#FFFFFF']);
  await page
    .getByRole('group', { name: 'Размер исходника объекта', exact: true })
    .getByRole('button', { name: 'L', exact: true })
    .click();
  expect(await geometryOf(first)).toBe(originalGeometry);
  expect(await bodyColor(first)).toBe('#FFD4F2');

  const exported = await downloadedSvg(page);
  expect(exported).not.toMatch(/var\s*\(/i);
  const document = new DOMParser().parseFromString(exported, 'image/svg+xml');
  const exportedItem = Array.from(document.getElementsByTagName('g')).find(
    (group) => group.getAttribute('data-item-id') === firstId,
  );
  expect(exportedItem).toBeDefined();
  expect(
    exportedItem!.getElementsByTagName('path')[0]!.getAttribute('fill'),
  ).toBe('#FFD4F2');
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  const screenSvg = await canvas
    .locator('svg')
    .first()
    .evaluate((svg) => svg.outerHTML);
  expect(canonical(exported)).toBe(canonical(screenSvg));
  expect(errors).toEqual([]);
});

test('main and background colors stay independent and reset only the current role', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const item = page
    .getByLabel('Холст композиции', { exact: true })
    .locator('[data-item-id]');
  const targets = page.getByRole('group', {
    name: 'Заменить на:',
    exact: true,
  });
  const reset = page.getByRole('button', {
    name: 'Сбросить цвета',
    exact: true,
  });
  const main = page.getByRole('button', { name: 'Главный', exact: true });
  const background = page.getByRole('button', { name: 'Фоновый', exact: true });
  await chooseColor(page, 1, 4);
  expect(await bodyColor(item)).toBe('#F9ECB0');

  await background.click();
  await expect(targets.getByRole('button')).toHaveCount(3);
  await expect(reset).toBeDisabled();
  expect(await bodyColor(item)).toBe('#D7CDF5');
  expect(Object.keys(await paintCounts(item)).sort()).toEqual([
    '#7864D7',
    '#D7CDF5',
  ]);
  await chooseColor(page, 1, 2);
  expect(await bodyColor(item)).toBe('#AA9BF0');
  expect(Object.keys(await paintCounts(item)).sort()).toEqual([
    '#7864D7',
    '#AA9BF0',
  ]);
  await expect(reset).toBeEnabled();
  await main.click();
  await expect(targets.getByRole('button')).toHaveCount(6);
  expect(await bodyColor(item)).toBe('#F9ECB0');
  await background.click();
  expect(await bodyColor(item)).toBe('#AA9BF0');
  await reset.click();
  expect(await bodyColor(item)).toBe('#D7CDF5');
  await expect(reset).toBeDisabled();
  await main.click();
  expect(await bodyColor(item)).toBe('#F9ECB0');
  await expect(reset).toBeEnabled();
  await reset.click();
  expect(await bodyColor(item)).toBe('#D7CDF5');
  await expect(reset).toBeDisabled();

  // Main-object accents may also use background colors without recoloring
  // either the body or the black and white structural details.
  const originalPaints = await paintCounts(item);
  const accent = page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 2', exact: true });
  await accent.focus();
  await page.keyboard.press('Enter');
  const shade = targets.getByRole('button', { name: 'Цвет 3', exact: true });
  await shade.focus();
  await page.keyboard.press('Space');
  await expect(accent).toHaveAttribute('aria-pressed', 'true');
  await expect(shade).toHaveAttribute('aria-pressed', 'true');
  expect(await bodyColor(item)).toBe('#D7CDF5');
  const accentPaints = await paintCounts(item);
  expect(accentPaints['#7864D7']).toBe(originalPaints['#F9ECB0']);
  expect(accentPaints['#F9ECB0']).toBeUndefined();
  expect(accentPaints['#181817']).toBe(originalPaints['#181817']);
  expect(accentPaints['#FFFFFF']).toBe(originalPaints['#FFFFFF']);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
