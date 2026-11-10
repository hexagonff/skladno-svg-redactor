import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator } from '@playwright/test';

async function geometryOf(element: Locator): Promise<string> {
  return element.evaluate((root) =>
    JSON.stringify(
      [root, ...root.querySelectorAll('*')].map((node) => ({
        tag: node.tagName,
        attributes: [...node.attributes]
          .filter(({ name }) => !['fill', 'stroke', 'style'].includes(name))
          .map(({ name, value }) => [name, value]),
      })),
    ),
  );
}

test('background and palette are independent and retain object edits in the editor and SVG export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const background = page.getByRole('combobox', { name: 'Фон', exact: true });
  const palette = page.getByRole('combobox', { name: 'Палитра', exact: true });
  await expect(background).toHaveValue('canvas1');
  await expect(palette).toHaveValue('purple');
  await expect(background.getByRole('option')).toHaveText([
    'Фон 1',
    'Фон 2',
    'Фон 3',
  ]);
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const artwork = canvas.locator('[data-canvas-id]');
  const item = canvas.locator('[data-item-id]');
  const detail = page.getByRole('group', {
    name: 'Детализация объекта',
    exact: true,
  });
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  const source = page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true });
  const targets = page.getByRole('group', {
    name: 'Заменить на:',
    exact: true,
  });
  await source.click();
  await targets.getByRole('button', { name: 'Цвет 4', exact: true }).click();
  await detail.getByRole('button', { name: 'S', exact: true }).click();
  await width.fill('300');
  await width.press('Enter');
  const initialTransform = await item.getAttribute('transform');
  const bounds = await item.locator('path').first().boundingBox();
  expect(bounds).not.toBeNull();
  const grab = {
    x: bounds!.x + bounds!.width * 0.6,
    y: bounds!.y + bounds!.height * 0.5,
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 35, grab.y + 25, { steps: 6 });
  await page.mouse.up();
  expect(await item.getAttribute('transform')).not.toBe(initialTransform);
  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  await source.click();
  await targets.getByRole('button', { name: 'Цвет 2', exact: true }).click();
  const objectBefore = await item.evaluate((element) => element.outerHTML);
  const objectGeometry = await geometryOf(item);
  const selectedChoice = page.getByRole('button', {
    name: 'Выбрать: Кошелёк, 1',
    exact: true,
  });
  const expectEdits = async () => {
    await expect(selectedChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(item).toHaveAttribute('data-detail-size', 'S');
    await expect(
      detail.getByRole('button', { name: 'S', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Фоновый', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => Number(await width.inputValue()))
      .toBeCloseTo(300, 2);
    await expect(
      targets.getByRole('button', { name: 'Цвет 2', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await geometryOf(item)).toBe(objectGeometry);
  };

  // A pattern change retains the palette and the entire object SVG.
  for (const canvasId of ['canvas1', 'canvas2', 'canvas3']) {
    await background.selectOption(canvasId);
    await expect(artwork).toHaveAttribute('data-canvas-id', canvasId);
    await expect(palette).toHaveValue('purple');
    await expect(artwork.locator('rect').first()).toHaveAttribute(
      'fill',
      '#D7CDF5',
    );
    expect(await item.evaluate((element) => element.outerHTML)).toBe(
      objectBefore,
    );
    await expectEdits();
  }

  // A palette change recolors the chosen pattern without replacing its geometry.
  await background.selectOption('canvas2');
  const canvasGeometry = await geometryOf(artwork);
  for (const [schemeId, bg1, bg2, bg3] of [
    ['purple', '#D7CDF5', '#AA9BF0', '#7864D7'],
    ['orange', '#FDD7B9', '#FAC896', '#D27532'],
    ['teal', '#BEEBEB', '#80DADA', '#5ABEBE'],
  ]) {
    await palette.selectOption(schemeId);
    await expect(background).toHaveValue('canvas2');
    await expect(artwork).toHaveAttribute('data-canvas-id', 'canvas2');
    await expect(artwork.locator('rect').first()).toHaveAttribute('fill', bg1);
    await expect(artwork.locator('path')).toHaveAttribute('fill', bg2);
    await expect(artwork.locator('line').first()).toHaveAttribute(
      'stroke',
      bg3,
    );
    await expect(artwork.locator('clipPath rect')).toHaveAttribute(
      'fill',
      'white',
    );
    await expect(item.locator('path').first()).toHaveAttribute('fill', bg2);
    expect(await geometryOf(artwork)).toBe(canvasGeometry);
    await expectEdits();
  }

  // Main and background overrides both survive the independent global controls.
  await page.getByRole('button', { name: 'Главный', exact: true }).click();
  await expect(item.locator('path').first()).toHaveAttribute('fill', '#FFD4F2');
  await expect(width).toHaveValue('300');
  await expect(item).toHaveAttribute('data-detail-size', 'S');
  await expect(selectedChoice).toHaveAttribute('aria-pressed', 'true');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const filename = await (await downloadEvent).path();
  expect(filename).not.toBeNull();
  const exported = await readFile(filename!, 'utf8');
  expect(exported).not.toMatch(
    /var\s*\(|object-selection|resize-corner|<button/,
  );
  const document = new DOMParser().parseFromString(exported, 'image/svg+xml');
  const exportedBackground = Array.from(
    document.getElementsByTagName('g'),
  ).find((group) => group.hasAttribute('data-canvas-id'));
  expect(exportedBackground!.getAttribute('data-canvas-id')).toBe('canvas2');
  expect(
    exportedBackground!.getElementsByTagName('rect')[0]!.getAttribute('fill'),
  ).toBe('#BEEBEB');
  for (const tag of ['image', 'foreignObject', 'style']) {
    expect(document.getElementsByTagName(tag)).toHaveLength(0);
  }
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
