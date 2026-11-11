import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';

function canvas(page: Page) {
  return page.getByLabel('Холст композиции', { exact: true });
}

function layer(page: Page, id: string) {
  return page
    .locator('li[data-layer-id="' + id + '"]')
    .getByRole('button', { name: /^Выбрать:/ });
}

function duplicateControls(page: Page) {
  const button = { name: 'Дублировать объект', exact: true };
  return {
    sidebar: page.locator('.selection-settings').getByRole('button', button),
    toolbar: page
      .getByRole('group', { name: 'Быстрые действия объекта', exact: true })
      .getByRole('button', button),
  };
}

async function positionOf(item: Locator) {
  const transform = await item.getAttribute('transform');
  const translation = transform?.match(/^translate\(([^)]+)\)/);
  if (!translation) throw new Error('Expected an object position.');
  const [x, y] = translation[1].split(/[\s,]+/).map(Number);
  return { x, y };
}

async function itemId(item: Locator): Promise<string> {
  const id = await item.getAttribute('data-item-id');
  if (!id) throw new Error('Expected an object instance.');
  return id;
}

// Normalize instance IDs and placement while comparing shape, paint, rotation, and scale.
async function appearance(item: Locator): Promise<string> {
  return item.evaluate((element) => {
    const ids = new Map(
      [...element.querySelectorAll('[id]')].map((node, index) => [
        node.getAttribute('id')!,
        'local-' + index,
      ]),
    );
    const reference = (value: string) => {
      if (value.startsWith('#') && ids.has(value.slice(1))) {
        return '#' + ids.get(value.slice(1));
      }
      return value.replace(
        /url\(#([^)]+)\)/g,
        (_, id: string) => 'url(#' + (ids.get(id) ?? id) + ')',
      );
    };
    return JSON.stringify(
      [element, ...element.querySelectorAll('*')].map((node) => ({
        tag: node.tagName,
        attributes: [...node.attributes]
          .filter(({ name }) => name !== 'data-item-id')
          .map(({ name, value }) => [
            name,
            name === 'id'
              ? ids.get(value)
              : reference(
                  node === element && name === 'transform'
                    ? value.replace(/^translate\([^)]+\)\s*/, '')
                    : value,
                ),
          ])
          .sort(([first], [second]) => first!.localeCompare(second!)),
      })),
    );
  });
}

async function chooseColor(page: Page, target: number) {
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет ' + target, exact: true })
    .click();
}

test('toolbar duplicate shifts an otherwise identical copy above its source and preserves independent edits in SVG export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const { sidebar: duplicate, toolbar: toolbarDuplicate } =
    duplicateControls(page);
  await expect(duplicate).toBeDisabled();
  await page
    .getByRole('combobox', { name: 'Фон', exact: true })
    .selectOption('canvas2');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const items = canvas(page).locator('[data-item-id]');
  const originalId = await itemId(items);
  const original = canvas(page).locator('[data-item-id="' + originalId + '"]');
  const detail = page.getByRole('group', {
    name: 'Детализация объекта',
    exact: true,
  });
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  const main = page.getByRole('button', { name: 'Главный', exact: true });
  const background = page.getByRole('button', { name: 'Фоновый', exact: true });
  const clockwise = page
    .getByRole('group', { name: 'Поворот объекта', exact: true })
    .getByRole('button', { name: 'Повернуть по часовой стрелке', exact: true });
  await detail.getByRole('button', { name: 'S', exact: true }).click();
  await width.fill('300');
  await width.press('Enter');
  await clockwise.click();
  await chooseColor(page, 4);
  const mainBefore = await appearance(original);
  await background.click();
  await chooseColor(page, 2);
  const backgroundBefore = await appearance(original);
  const originalPosition = await positionOf(original);

  // A higher layer makes appending the duplicate to the end observably incorrect.
  await page
    .getByRole('button', { name: 'Добавить: Телефон', exact: true })
    .click();
  const upperId = await itemId(items.nth(1));
  await layer(page, originalId).click();
  await toolbarDuplicate.click();
  await expect(items).toHaveCount(3);
  const copyId = await itemId(items.nth(1));
  expect(copyId).not.toBe(originalId);
  const copy = canvas(page).locator('[data-item-id="' + copyId + '"]');
  await expect(copy).toHaveAttribute('data-asset-id', 'wallet');
  const copyPosition = await positionOf(copy);
  expect(copyPosition.x - originalPosition.x).toBeCloseTo(16, 8);
  expect(copyPosition.y - originalPosition.y).toBeCloseTo(16, 8);
  expect(await positionOf(original)).toEqual(originalPosition);
  expect(
    await items.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-item-id')),
    ),
  ).toEqual([originalId, copyId, upperId]);
  await expect(layer(page, copyId)).toHaveAttribute('aria-pressed', 'true');
  await expect(layer(page, originalId)).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(copy).toHaveAttribute('data-detail-size', 'S');
  await expect(width).toHaveValue('300');
  await expect(page.getByLabel('Угол поворота', { exact: true })).toHaveText(
    '15°',
  );
  await expect(background).toHaveAttribute('aria-pressed', 'true');
  expect(await appearance(copy)).toBe(backgroundBefore);
  expect(await appearance(original)).toBe(backgroundBefore);

  await main.click();
  expect(await appearance(copy)).toBe(mainBefore);
  await background.click();
  expect(await appearance(copy)).toBe(backgroundBefore);
  await main.click();
  await chooseColor(page, 5);
  await width.fill('280');
  await width.press('Enter');
  await clockwise.click();
  await detail.getByRole('button', { name: 'L', exact: true }).click();
  await background.click();
  await chooseColor(page, 3);
  const editedCopy = await appearance(copy);
  expect(editedCopy).not.toBe(backgroundBefore);
  expect(await appearance(original)).toBe(backgroundBefore);

  // Inspect the source's inactive color map too: editing either copy must not alias it.
  await layer(page, originalId).click();
  await expect(width).toHaveValue('300');
  await expect(original).toHaveAttribute('data-detail-size', 'S');
  await expect(page.getByLabel('Угол поворота', { exact: true })).toHaveText(
    '15°',
  );
  await main.click();
  expect(await appearance(original)).toBe(mainBefore);
  await background.click();
  expect(await appearance(original)).toBe(backgroundBefore);
  expect(await appearance(copy)).toBe(editedCopy);
  expect(await positionOf(original)).toEqual(originalPosition);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const filename = await (await download).path();
  if (!filename) throw new Error('Expected an SVG download.');
  const exported = await readFile(filename, 'utf8');
  const document = new DOMParser().parseFromString(exported, 'image/svg+xml');
  const groups = Array.from(document.getElementsByTagName('g'));
  const exportedItems = groups.filter((group) =>
    group.hasAttribute('data-item-id'),
  );
  expect(
    exportedItems.filter(
      (group) => group.getAttribute('data-asset-id') === 'wallet',
    ),
  ).toHaveLength(2);
  const instanceIds = exportedItems.map((group) =>
    group.getAttribute('data-item-id'),
  );
  expect(instanceIds).toEqual([originalId, copyId, upperId]);
  expect(new Set(instanceIds).size).toBe(instanceIds.length);
  const svgIds = Array.from(document.getElementsByTagName('*'))
    .filter((element) => element.hasAttribute('id'))
    .map((element) => element.getAttribute('id'));
  expect(svgIds.length).toBeGreaterThan(0);
  expect(new Set(svgIds).size).toBe(svgIds.length);
  expect(exported).not.toMatch(/<image|foreignObject|<style|<button|var\s*\(/);
  expect(errors).toEqual([]);
});

test.describe('duplicate on a narrow touch screen', () => {
  test.use({
    viewport: { width: 320, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('keyboard and touch duplication select a fresh copy and deletion preserves its source', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const { sidebar: duplicate, toolbar: toolbarDuplicate } =
      duplicateControls(page);
    const remove = page.getByRole('button', {
      name: 'Удалить выбранный',
      exact: true,
    });
    await expect(duplicate).toBeDisabled();
    await page
      .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
      .tap();
    const items = canvas(page).locator('[data-item-id]');
    const originalId = await itemId(items);
    const original = canvas(page).locator(
      '[data-item-id="' + originalId + '"]',
    );
    const before = await appearance(original);
    const originalPosition = await positionOf(original);
    await duplicate.focus();
    await page.keyboard.press('Enter');
    await expect(items).toHaveCount(2);
    const firstCopyId = await itemId(items.nth(1));
    expect(firstCopyId).not.toBe(originalId);
    const firstCopyPosition = await positionOf(items.nth(1));
    expect(firstCopyPosition.x - originalPosition.x).toBeCloseTo(16, 8);
    expect(firstCopyPosition.y - originalPosition.y).toBeCloseTo(16, 8);
    expect(await appearance(items.nth(1))).toBe(before);
    await expect(items.nth(1)).toHaveAttribute('data-detail-size', 'L');
    await expect(layer(page, firstCopyId)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await remove.tap();
    await expect(items).toHaveCount(1);
    await expect(duplicate).toBeDisabled();
    expect(await appearance(original)).toBe(before);

    await layer(page, originalId).tap();
    const toolbar = page.getByRole('group', {
      name: 'Быстрые действия объекта',
      exact: true,
    });
    await toolbar.scrollIntoViewIfNeeded();
    const toolbarBox = await toolbar.boundingBox();
    const canvasBox = await canvas(page).locator(':scope > svg').boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(
      canvasBox!.x + canvasBox!.width,
    );
    const buttonBox = await toolbarDuplicate.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(320);
    await toolbarDuplicate.tap();
    await expect(items).toHaveCount(2);
    const secondCopyId = await itemId(items.nth(1));
    expect([originalId, firstCopyId]).not.toContain(secondCopyId);
    const secondCopyPosition = await positionOf(items.nth(1));
    expect(secondCopyPosition.x - originalPosition.x).toBeCloseTo(16, 8);
    expect(secondCopyPosition.y - originalPosition.y).toBeCloseTo(16, 8);
    expect(await positionOf(original)).toEqual(originalPosition);
    await expect(layer(page, secondCopyId)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(layer(page, originalId)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await appearance(items.nth(1))).toBe(before);
    await remove.tap();
    await expect(items).toHaveCount(1);
    await expect(duplicate).toBeDisabled();
    expect(await appearance(original)).toBe(before);
    await layer(page, originalId).tap();
    await remove.tap();
    await expect(items).toHaveCount(0);
    await expect(duplicate).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
});
