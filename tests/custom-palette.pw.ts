import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <defs><clipPath id="cut"><rect width="200" height="100" fill="white"/></clipPath></defs>
  <g clip-path="url(#cut)">
    <rect width="200" height="100" fill="#D7CDF5" stroke="#181817"/>
    <path d="M20 20H100V80H20Z" fill="#F9ECB0"/>
    <circle cx="150" cy="50" r="15" fill="white"/>
    <ellipse cx="175" cy="80" rx="8" ry="5" fill="#FFE3E1"/>
  </g>
</svg>`;

const COLOR_FIELDS = [
  ['Фон 1', '123456'],
  ['Фон 2', '#345'],
  ['Фон 3', '#56789a'],
  ['Объект 1', '#789abc'],
  ['Объект 2', '#9abcde'],
  ['Объект 3', '#abcdef'],
  ['Чёрный', '#102030'],
  ['Белый', '#f1f2f3'],
] as const;

const REPLACEMENTS: Record<string, string> = {
  '#D7CDF5': '#123456',
  '#AA9BF0': '#334455',
  '#7864D7': '#56789A',
  '#F9ECB0': '#789ABC',
  '#F9A3AA': '#9ABCDE',
  '#FFE3E1': '#AABBCC',
  '#181817': '#102030',
  '#FFFFFF': '#F1F2F3',
};

function canvasSvg(page: Page) {
  return page
    .getByLabel('Холст композиции', { exact: true })
    .locator(':scope > svg');
}

function paletteSelect(page: Page) {
  return page.getByRole('combobox', { name: 'Палитра', exact: true });
}

function addPalette(page: Page) {
  return page.getByRole('button', { name: 'Добавить палитру', exact: true });
}

function paletteDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Новая палитра', exact: true });
}

async function upload(page: Page, name = 'palette-test.svg') {
  await page.getByLabel('Файл SVG', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(SOURCE_SVG, 'utf8'),
  });
  return page.getByRole('button', {
    name: `Добавить: ${name.replace(/\.svg$/, '')}`,
    exact: true,
  });
}

async function configurePalette(dialog: Locator, name: string) {
  await dialog
    .getByRole('textbox', { name: 'Название палитры', exact: true })
    .fill(name);
  for (const [label, value] of COLOR_FIELDS) {
    await dialog.getByRole('textbox', { name: label, exact: true }).fill(value);
  }
  await dialog
    .getByLabel('Выбрать цвет: Объект 3', { exact: true })
    .fill('#aabbcc');
}

async function paintsOf(root: Locator) {
  return root.evaluate((element) =>
    [element, ...element.querySelectorAll('*')]
      .filter((node) => !node.closest('defs, clipPath'))
      .flatMap((node) =>
        ['fill', 'stroke'].flatMap((attribute) => {
          const value = node.getAttribute(attribute);
          return value === null
            ? []
            : [{ tag: node.tagName, attribute, value }];
        }),
      ),
  );
}

async function geometryOf(root: Locator) {
  return root.evaluate((element) =>
    JSON.stringify(
      [element, ...element.querySelectorAll('*')].map((node) => ({
        tag: node.tagName,
        attributes: [...node.attributes]
          .filter(({ name }) => !['fill', 'stroke', 'style'].includes(name))
          .map(({ name, value }) => [name, value]),
      })),
    ),
  );
}

async function expectCanonicalExport(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Expected a downloaded SVG composition.');
  const exported = await readFile(path, 'utf8');
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  expect(canonical(exported)).toBe(
    canonical(await canvasSvg(page).evaluate((svg) => svg.outerHTML)),
  );
  expect(exported).not.toMatch(/var\s*\(|<image|foreignObject|<style|<button/);
  return exported;
}

test('custom palette recolors the canvas, main and background objects, uploads and previews while preserving edits and vector export', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Фон', exact: true })
    .selectOption('canvas2');
  const addWallet = page.getByRole('button', {
    name: 'Добавить: Кошелёк',
    exact: true,
  });
  await addWallet.click();
  await page
    .getByRole('group', { name: 'Детализация объекта', exact: true })
    .getByRole('button', { name: 'S', exact: true })
    .click();
  await page
    .getByRole('spinbutton', { name: 'Ширина', exact: true })
    .fill('280');
  await page
    .getByRole('spinbutton', { name: 'Ширина', exact: true })
    .press('Enter');
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 5', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Быстрые действия объекта', exact: true })
    .getByRole('button', { name: 'Повернуть по часовой стрелке', exact: true })
    .click();
  await addWallet.click();
  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  const customAdd = await upload(page);
  await customAdd.click();
  const scene = canvasSvg(page);
  const items = scene.locator('[data-item-id]');
  await expect(items).toHaveCount(3);
  const imported = items.nth(2);
  const beforeGeometry = await geometryOf(scene);
  const beforePaints = await paintsOf(scene);
  const beforePreviews = [
    await paintsOf(addWallet.locator('svg')),
    await paintsOf(customAdd.locator('svg')),
  ];
  await addPalette(page).click();
  const dialog = paletteDialog(page);
  await configurePalette(dialog, 'Моя демонстрация');
  await page.screenshot({
    path: testInfo.outputPath('custom-palette-dialog-desktop.png'),
  });
  await dialog
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(paletteSelect(page).locator('option:checked')).toHaveText(
    'Моя демонстрация',
  );
  await expect(
    page.getByRole('combobox', { name: 'Фон', exact: true }),
  ).toHaveValue('canvas2');
  expect(await geometryOf(scene)).toBe(beforeGeometry);
  expect(await paintsOf(scene)).toEqual(
    beforePaints.map((paint) => ({
      ...paint,
      value: REPLACEMENTS[paint.value] ?? paint.value,
    })),
  );
  for (const [index, preview] of [
    addWallet.locator('svg'),
    customAdd.locator('svg'),
  ].entries()) {
    expect(await paintsOf(preview)).toEqual(
      beforePreviews[index].map((paint) => ({
        ...paint,
        value: REPLACEMENTS[paint.value] ?? paint.value,
      })),
    );
  }
  await expect(items.nth(0)).toHaveAttribute('data-detail-size', 'S');
  await expect(items.nth(0).locator('path').first()).toHaveAttribute(
    'fill',
    '#9ABCDE',
  );
  await expect(imported.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#123456',
  );
  await expect(imported.locator('g[clip-path] > rect')).toHaveAttribute(
    'stroke',
    '#102030',
  );
  await expect(imported.locator('circle')).toHaveAttribute('fill', '#F1F2F3');
  await expect(imported.locator('clipPath rect')).toHaveAttribute(
    'fill',
    '#FFFFFF',
  );
  // The live scene remains editable after choosing a session-only palette.
  await page
    .getByRole('spinbutton', { name: 'Ширина', exact: true })
    .fill('180');
  await page
    .getByRole('spinbutton', { name: 'Ширина', exact: true })
    .press('Enter');
  await page
    .getByRole('group', { name: 'Быстрые действия объекта', exact: true })
    .getByRole('button', { name: 'Повернуть по часовой стрелке', exact: true })
    .click();
  const beforeMove = await imported.getAttribute('transform');
  const point = await imported.locator('svg').evaluate((svg) => {
    const element = svg as SVGSVGElement;
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Expected an SVG transformation.');
    const box = element.viewBox.baseVal;
    const center = new DOMPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    ).matrixTransform(matrix);
    return { x: center.x, y: center.y };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 25, point.y + 20, { steps: 6 });
  await page.mouse.up();
  expect(await imported.getAttribute('transform')).not.toBe(beforeMove);
  await expect(page.getByLabel('Угол поворота', { exact: true })).toHaveText(
    '15°',
  );
  await expect(
    page.getByRole('spinbutton', { name: 'Ширина', exact: true }),
  ).toHaveValue('180');
  const exported = await expectCanonicalExport(page);
  for (const color of Object.values(REPLACEMENTS))
    expect(exported).toContain(color);
  await page.locator('.workspace__panel').evaluateAll((panels) => {
    for (const panel of panels) panel.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath('custom-palette-desktop.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('session palettes switch independently and disappear on reload without storage or server writes', async ({
  page,
}) => {
  const storageWrites: string[] = [];
  const mutatingRequests: string[] = [];
  await page.exposeFunction('recordPaletteStorageWrite', (key: string) => {
    storageWrites.push(key);
  });
  await page.addInitScript(() => {
    Storage.prototype.setItem = function (key: string) {
      void (
        window as unknown as {
          recordPaletteStorageWrite: (value: string) => Promise<void>;
        }
      ).recordPaletteStorageWrite(key);
      throw new Error('Session palettes must not use browser storage.');
    };
  });
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      mutatingRequests.push(request.url());
  });
  await page.goto('/');
  const customAdd = await upload(page, 'temporary.svg');
  await customAdd.click();
  await addPalette(page).click();
  await configurePalette(paletteDialog(page), 'На время показа');
  await paletteDialog(page)
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  const customId = await paletteSelect(page).inputValue();
  expect(['purple', 'orange', 'teal']).not.toContain(customId);
  const customPaints = await paintsOf(canvasSvg(page));
  await paletteSelect(page).selectOption('teal');
  await expect(
    canvasSvg(page).locator('[data-canvas-id] rect').first(),
  ).toHaveAttribute('fill', '#BEEBEB');
  await paletteSelect(page).selectOption(customId);
  expect(await paintsOf(canvasSvg(page))).toEqual(customPaints);
  // Opening another palette starts with the active custom colors, without mutating it.
  await addPalette(page).click();
  await expect(
    paletteDialog(page).getByRole('textbox', { name: 'Фон 1', exact: true }),
  ).toHaveValue('#123456');
  await paletteDialog(page)
    .getByRole('textbox', { name: 'Название палитры', exact: true })
    .fill('Ещё одна');
  await paletteDialog(page)
    .getByRole('textbox', { name: 'Фон 1', exact: true })
    .fill('#654321');
  await paletteDialog(page)
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  expect(await paletteSelect(page).inputValue()).not.toBe(customId);
  await expect(paletteSelect(page).getByRole('option')).toHaveCount(5);
  await paletteSelect(page).selectOption(customId);
  expect(await paintsOf(canvasSvg(page))).toEqual(customPaints);
  await page.reload();
  await expect(paletteSelect(page)).toHaveValue('purple');
  await expect(paletteSelect(page).getByRole('option')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Добавить: temporary', exact: true }),
  ).toHaveCount(0);
  await expect(canvasSvg(page).locator('[data-item-id]')).toHaveCount(0);
  expect(storageWrites).toEqual([]);
  expect(mutatingRequests).toEqual([]);
});

test('palette validation leaves the scene unchanged and cancel, Escape and backdrop discard drafts with contained focus', async ({
  page,
}) => {
  await page.goto('/');
  const sceneBefore = await canvasSvg(page).evaluate((svg) => svg.outerHTML);
  const trigger = addPalette(page);
  await trigger.click();
  const dialog = paletteDialog(page);
  const name = dialog.getByRole('textbox', {
    name: 'Название палитры',
    exact: true,
  });
  await expect(name).toBeFocused();
  await name.fill('   ');
  await dialog
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(page.locator('#scheme-select option')).toHaveCount(3);
  expect(await canvasSvg(page).evaluate((svg) => svg.outerHTML)).toBe(
    sceneBefore,
  );
  await name.fill('Совпадающие цвета');
  const color = dialog.getByRole('textbox', { name: 'Фон 1', exact: true });
  await color.fill('#12xy56');
  await dialog
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  await expect(color).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#scheme-select option')).toHaveCount(3);
  expect(await canvasSvg(page).evaluate((svg) => svg.outerHTML)).toBe(
    sceneBefore,
  );
  await color.fill('abc');
  await dialog
    .getByRole('textbox', { name: 'Объект 1', exact: true })
    .fill('#aabbcc');
  await dialog
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(paletteSelect(page).getByRole('option')).toHaveCount(4);
  const customId = await paletteSelect(page).inputValue();
  const sceneWithCustom = await canvasSvg(page).evaluate(
    (svg) => svg.outerHTML,
  );
  for (const dismissal of ['cancel', 'escape', 'backdrop', 'close']) {
    await trigger.click();
    await expect(
      dialog.getByRole('textbox', { name: 'Фон 1', exact: true }),
    ).toHaveValue('#AABBCC');
    await dialog
      .getByRole('textbox', { name: 'Фон 1', exact: true })
      .fill('#111111');
    // Native dialog focus must never enter the controls behind the modal.
    for (let index = 0; index < 22; index += 1) {
      await page.keyboard.press('Tab');
      const focus = await dialog.evaluate((element) => ({
        modal: element.matches(':modal'),
        inside: element.contains(document.activeElement),
        browserChrome: document.activeElement === document.body,
        outsideElement: document.activeElement?.outerHTML.slice(0, 200),
      }));
      expect(focus.modal).toBe(true);
      // Native dialogs may hand focus to browser chrome, but never to the inert page.
      expect(focus.inside || focus.browserChrome, focus.outsideElement).toBe(
        true,
      );
      if (focus.browserChrome) {
        await page.keyboard.press('Tab');
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
    }
    if (dismissal === 'cancel')
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    else if (dismissal === 'escape') await page.keyboard.press('Escape');
    else if (dismissal === 'close')
      await dialog
        .getByRole('button', { name: 'Закрыть', exact: true })
        .click();
    else {
      const bounds = await dialog.boundingBox();
      if (!bounds) throw new Error('Expected an open palette dialog.');
      await page.mouse.click(
        Math.max(1, bounds.x - 12),
        Math.max(1, bounds.y - 12),
      );
    }
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(paletteSelect(page)).toHaveValue(customId);
    await expect(paletteSelect(page).getByRole('option')).toHaveCount(4);
    expect(await canvasSvg(page).evaluate((svg) => svg.outerHTML)).toBe(
      sceneWithCustom,
    );
  }
});

test('narrow-screen palette dialog scrolls within the viewport and applies all eight colors', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await addPalette(page).click();
  const dialog = paletteDialog(page);
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error('Expected a visible palette dialog.');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
  expect(
    await dialog.evaluate((element) =>
      [element, ...element.querySelectorAll('*')].some(
        (node) =>
          node.scrollHeight > node.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(node).overflowY),
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await configurePalette(dialog, 'Мобильная');
  await dialog
    .getByRole('textbox', { name: 'Белый', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('custom-palette-dialog-mobile.png'),
  });
  await dialog
    .getByRole('button', { name: 'Добавить и применить', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(paletteSelect(page).locator('option:checked')).toHaveText(
    'Мобильная',
  );
  await expect(
    canvasSvg(page).locator('[data-canvas-id] rect').first(),
  ).toHaveAttribute('fill', '#123456');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
