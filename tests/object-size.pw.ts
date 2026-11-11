import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { expect, test, type Locator } from '@playwright/test';
import { svgViewportBounds } from './svgViewport';

function viewportBounds(item: Locator) {
  return svgViewportBounds(item.locator('svg').first());
}

async function poseOf(item: Locator): Promise<string> {
  // Detail changes retain the centre and rotation without normalizing the source width.
  return (await item.getAttribute('transform'))!.split(' scale(')[0]!;
}

async function expectNativeViewport(
  item: Locator,
  width: number,
  height: number,
) {
  const viewport = item.locator('svg').first();
  await expect(viewport).toHaveAttribute('width', String(width));
  await expect(viewport).toHaveAttribute('height', String(height));
  await expect(viewport).toHaveAttribute('viewBox', `0 0 ${width} ${height}`);
}

test('each wallet keeps its detail level, native size, colors and role in the editor and export', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const size = page.getByRole('group', {
    name: 'Размер исходника объекта',
    exact: true,
  });
  await expect(size).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Детализация', exact: true }),
  ).toHaveCount(0);
  const addWallet = page.getByRole('button', {
    name: 'Добавить: Кошелёк',
    exact: true,
  });
  await addWallet.click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const wallets = canvas.locator('[data-item-id][data-asset-id="wallet"]');
  const firstId = await wallets.first().getAttribute('data-item-id');
  const first = canvas.locator(`[data-item-id="${firstId}"]`);
  const firstPose = await poseOf(first);
  const largeBounds = await viewportBounds(first);
  const boardBounds = await canvas.locator('svg').first().boundingBox();
  expect(boardBounds).not.toBeNull();
  await expectNativeViewport(first, 631, 397);
  // The familiar default scale is restored for each new item.
  expect(largeBounds.width / boardBounds!.width).toBeCloseTo(631 / 1000, 4);
  expect(largeBounds.height / boardBounds!.height).toBeCloseTo(397 / 1000, 4);
  await expect(
    size.getByRole('button', { name: 'L', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    Number(
      await page
        .getByRole('spinbutton', { name: 'Ширина', exact: true })
        .inputValue(),
    ),
  ).toBeCloseTo(631, 2);
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 4', exact: true })
    .click();
  await size.getByRole('button', { name: 'S', exact: true }).click();
  await expectNativeViewport(first, 316, 199);
  await expect(first).toHaveAttribute('data-detail-size', 'S');
  await expect(first.locator('path')).toHaveCount(83);
  await expect(first.locator('path').first()).toHaveAttribute(
    'fill',
    '#F9ECB0',
  );
  await expect(
    page.getByRole('button', { name: 'Главный', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    Number(
      await page
        .getByRole('spinbutton', { name: 'Ширина', exact: true })
        .inputValue(),
    ),
  ).toBeCloseTo(316, 2);
  expect(await poseOf(first)).toBe(firstPose);
  const smallBounds = await viewportBounds(first);
  expect(smallBounds.width / largeBounds.width).toBeCloseTo(316 / 631, 4);
  expect(smallBounds.height / largeBounds.height).toBeCloseTo(199 / 397, 4);
  expect(smallBounds.x + smallBounds.width / 2).toBeCloseTo(
    largeBounds.x + largeBounds.width / 2,
    3,
  );
  expect(smallBounds.y + smallBounds.height / 2).toBeCloseTo(
    largeBounds.y + largeBounds.height / 2,
    3,
  );

  await addWallet.click();
  await expect(wallets).toHaveCount(2);
  const secondId = await wallets.nth(1).getAttribute('data-item-id');
  const second = canvas.locator(`[data-item-id="${secondId}"]`);
  await expect(
    size.getByRole('button', { name: 'L', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('data-detail-size', 'L');
  await expect(second.locator('path')).toHaveCount(86);
  await expectNativeViewport(second, 631, 397);
  await expect(first).toHaveAttribute('data-detail-size', 'S');
  await expect(second.locator('path').first()).toHaveAttribute(
    'fill',
    '#D7CDF5',
  );
  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 2', exact: true })
    .click();
  const secondPose = await poseOf(second);
  const secondBounds = await viewportBounds(second);
  await page
    .getByRole('button', { name: 'Выбрать: Кошелёк, 1', exact: true })
    .click();
  await expect(
    size.getByRole('button', { name: 'S', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Главный', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await size.getByRole('button', { name: 'L', exact: true }).click();
  await expectNativeViewport(first, 631, 397);
  await expect(first.locator('path')).toHaveCount(86);
  await expect(first.locator('path').first()).toHaveAttribute(
    'fill',
    '#F9ECB0',
  );
  await size.getByRole('button', { name: 'S', exact: true }).click();
  expect(await poseOf(first)).toBe(firstPose);
  expect(await poseOf(second)).toBe(secondPose);
  expect(await viewportBounds(second)).toEqual(secondBounds);
  await expect(second.locator('path').first()).toHaveAttribute(
    'fill',
    '#AA9BF0',
  );
  await page
    .getByRole('button', { name: 'Выбрать: Кошелёк, 2', exact: true })
    .click();
  await expect(
    size.getByRole('button', { name: 'L', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Фоновый', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('teal');
  await expect(first.locator('path').first()).toHaveAttribute(
    'fill',
    '#FFD4F2',
  );
  await expect(second.locator('path').first()).toHaveAttribute(
    'fill',
    '#80DADA',
  );
  await expect(first).toHaveAttribute('data-detail-size', 'S');
  await expect(second).toHaveAttribute('data-detail-size', 'L');
  await expect(canvas.locator('[data-canvas-id]')).toHaveAttribute(
    'data-detail-size',
    'L',
  );

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const filename = await (await downloadEvent).path();
  expect(filename).not.toBeNull();
  const exported = new DOMParser().parseFromString(
    await readFile(filename!, 'utf8'),
    'image/svg+xml',
  );
  const groups = Array.from(exported.getElementsByTagName('g'));
  for (const [id, selectedSize, width, height, fill] of [
    [firstId, 'S', 316, 199, '#FFD4F2'],
    [secondId, 'L', 631, 397, '#80DADA'],
  ] as const) {
    const group = groups.find(
      (entry) => entry.getAttribute('data-item-id') === id,
    );
    expect(group).toBeDefined();
    expect(group!.getAttribute('data-detail-size')).toBe(selectedSize);
    const scale = /scale\(([-+\d.eE]+)\)/.exec(
      group!.getAttribute('transform')!,
    );
    expect(scale).not.toBeNull();
    expect(Number(scale![1])).toBeCloseTo(1, 8);
    const viewport = group!.getElementsByTagName('svg')[0]!;
    expect(viewport.getAttribute('width')).toBe(String(width));
    expect(viewport.getAttribute('height')).toBe(String(height));
    expect(viewport.getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`);
    expect(group!.getElementsByTagName('path')[0]!.getAttribute('fill')).toBe(
      fill,
    );
  }
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('detail-levels.png'),
    fullPage: true,
  });
});
