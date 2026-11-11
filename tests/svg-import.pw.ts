import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test, type Page } from '@playwright/test';
import { svgViewportBounds } from './svgViewport';

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="10 20 200 100">
  <defs><clipPath id="cut"><rect x="10" y="20" width="200" height="100" fill="white"/></clipPath></defs>
  <g clip-path="url(#cut)">
    <rect x="10" y="20" width="200" height="100" fill="rgb(215, 205, 245)" stroke="black"/>
    <path d="M30 40 L100 40 L60 100 Z" fill="#F9ECB0"/>
    <circle cx="170" cy="70" r="12" fill="#d7cdf5"/>
    <line x1="150" y1="95" x2="190" y2="95" stroke="rgb(249, 236, 176)"/>
  </g>
</svg>`;

async function upload(
  page: Page,
  source: string,
  name = 'custom.svg',
  mimeType = 'image/svg+xml',
) {
  await page.getByLabel('Файл SVG', { exact: true }).setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(source, 'utf8'),
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('uploaded SVG retains its own viewBox, colors and proportions in independent instances and export', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await upload(page, SOURCE_SVG, 'origin-offset.svg');
  const add = page.getByRole('button', {
    name: 'Добавить: origin-offset',
    exact: true,
  });
  await expect(add).toBeVisible();
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    11,
  );
  await expect(
    page.getByRole('button', { name: /^Добавить:/ }).first(),
  ).toHaveAccessibleName('Добавить: origin-offset');
  await expect(
    page.getByRole('form', { name: 'Настройки загружаемого SVG', exact: true }),
  ).toHaveCount(0);
  const preview = add.locator('svg');
  await expect(preview).toHaveAttribute('viewBox', '10 20 200 100');
  await expect(preview.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#D7CDF5',
  );
  await expect(preview.locator('circle')).toHaveAttribute('fill', '#D7CDF5');
  await expect(preview.locator('line')).toHaveAttribute('stroke', '#F9ECB0');
  await add.click();
  await add.click();
  await expect(
    page
      .getByRole('group', { name: 'Используемые цвета', exact: true })
      .getByRole('button'),
  ).toHaveCount(2);
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const items = canvas.locator('[data-item-id][data-asset-id^="custom-"]');
  await expect(items).toHaveCount(2);
  const first = items.nth(0);
  const second = items.nth(1);
  await expect(first).toHaveAttribute('data-detail-size', 'L');
  await expect(first.locator('svg')).toHaveAttribute(
    'viewBox',
    '10 20 200 100',
  );
  await expect(first.locator('svg')).toHaveAttribute('width', '400');
  await expect(first.locator('svg')).toHaveAttribute('height', '400');
  await expect(first.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#D7CDF5',
  );
  await expect(first.locator('path')).toHaveAttribute('fill', '#F9ECB0');
  await expect(first.locator('clipPath rect')).toHaveAttribute(
    'fill',
    '#FFFFFF',
  );
  const detail = page.getByRole('group', {
    name: 'Размер исходника объекта',
    exact: true,
  });
  await expect(
    detail.getByRole('button', { name: 'S', exact: true }),
  ).toBeDisabled();
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('300');
  await width.press('Enter');
  await expect(width).toHaveValue('300');
  await expect(
    page.getByRole('spinbutton', { name: 'Высота', exact: true }),
  ).toHaveValue('300');
  const firstBounds = await svgViewportBounds(first.locator('svg'));
  const secondBounds = await svgViewportBounds(second.locator('svg'));
  const boardBounds = await svgViewportBounds(canvas.locator('svg').first());
  for (const [bounds, offset] of [
    [firstBounds, 0],
    [secondBounds, 24],
  ] as const) {
    expect(bounds.x + bounds.width / 2).toBeCloseTo(
      boardBounds.x + boardBounds.width * (0.5 + offset / 1000),
      4,
    );
    expect(bounds.y + bounds.height / 2).toBeCloseTo(
      boardBounds.y + boardBounds.height * (0.5 + offset / 1000),
      4,
    );
  }
  expect(secondBounds.width / secondBounds.height).toBeCloseTo(2, 6);
  expect(secondBounds.width / firstBounds.width).toBeCloseTo(300 / 400, 6);
  await page
    .getByRole('group', { name: 'Используемые цвета', exact: true })
    .getByRole('button', { name: 'Участок 1', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 6', exact: true })
    .click();
  await expect(second.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#FFE3E1',
  );
  await expect(first.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#D7CDF5',
  );
  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  await expect(second.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#D7CDF5',
  );
  await expect(second.locator('path')).toHaveAttribute('fill', '#D7CDF5');
  await expect(second.locator('g[clip-path] > rect')).toHaveAttribute(
    'stroke',
    '#7864D7',
  );
  await page.getByRole('button', { name: 'Главный', exact: true }).click();
  await expect(second.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#FFE3E1',
  );
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('orange');
  await expect(second.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#BEEBEB',
  );
  await expect(first.locator('g[clip-path] > rect')).toHaveAttribute(
    'fill',
    '#FDD7B9',
  );
  await page.getByRole('button', { name: 'Фоновый', exact: true }).click();
  await expect(second.locator('g[clip-path] > rect')).toHaveAttribute(
    'stroke',
    '#D27532',
  );
  await expect(second.locator('path')).toHaveAttribute('fill', '#FDD7B9');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const path = await (await downloadEvent).path();
  expect(path).not.toBeNull();
  const exported = await readFile(path!, 'utf8');
  const exportedDocument = new DOMParser().parseFromString(
    exported,
    'image/svg+xml',
  );
  const elements = Array.from(exportedDocument.getElementsByTagName('*'));
  const ids = elements
    .filter((element) => element.hasAttribute('id'))
    .map((element) => element.getAttribute('id'));
  expect(new Set(ids).size).toBe(ids.length);
  expect(exportedDocument.getElementsByTagName('clipPath').length).toBe(2);
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/g))
        expect(ids).toContain(match[1]);
    }
  }
  for (const tag of ['image', 'foreignObject', 'style', 'script'])
    expect(exportedDocument.getElementsByTagName(tag).length).toBe(0);
  expect(exported).not.toMatch(/var\s*\(/i);
  const canonical = (svg: string) =>
    new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(svg, 'image/svg+xml'),
    );
  expect(canonical(exported)).toBe(
    canonical(
      await canvas
        .locator('svg')
        .first()
        .evaluate((svg) => svg.outerHTML),
    ),
  );
  await expectNoHorizontalOverflow(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.locator('.workspace__panel').evaluateAll((panels) => {
    for (const panel of panels) panel.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath('svg-import-scene-desktop.png'),
    fullPage: true,
  });
});

test('arbitrary source colors are assigned automatically and normalized duplicates share one editable color', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await upload(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="0" y="0" width="50" height="100" fill="#123456"/>
    <circle cx="30" cy="30" r="10" fill="rgb(18, 52, 86)"/>
    <path d="M50 0H100V100H50Z" fill="red"/>
    <ellipse cx="70" cy="30" rx="10" ry="8" fill="#f00"/>
    <line x1="0" y1="0" x2="100" y2="100" stroke="rgb(0, 0, 0)"/>
    <polyline points="0,100 100,0" fill="none" stroke="white"/>
  </svg>`,
    'automatic.svg',
  );
  const add = page.getByRole('button', {
    name: 'Добавить: automatic',
    exact: true,
  });
  await expect(add).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('form')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Роль цвета/ })).toHaveCount(
    0,
  );
  await add.click();
  const imported = page
    .getByLabel('Холст композиции', { exact: true })
    .locator('[data-asset-id^="custom-"]');
  const sourceColors = await imported.evaluate((item) => {
    const color = (selector: string, attribute = 'fill') =>
      item.querySelector(selector)?.getAttribute(attribute);
    return {
      rect: color('rect'),
      circle: color('circle'),
      path: color('path'),
      ellipse: color('ellipse'),
      black: color('line', 'stroke'),
      white: color('polyline', 'stroke'),
    };
  });
  expect(sourceColors.rect).toMatch(/^#[0-9A-F]{6}$/);
  expect(sourceColors.circle).toBe(sourceColors.rect);
  expect(sourceColors.ellipse).toBe(sourceColors.path);
  expect(sourceColors.rect).not.toBe(sourceColors.path);
  expect(sourceColors.black).toBe('#181817');
  expect(sourceColors.white).toBe('#FFFFFF');
  const used = page.getByRole('group', {
    name: 'Используемые цвета',
    exact: true,
  });
  await expect(used.getByRole('button')).toHaveCount(2);
  await used.getByRole('button').first().click();
  await page
    .getByRole('group', { name: 'Заменить на:', exact: true })
    .getByRole('button', { name: 'Цвет 1', exact: true })
    .click();
  await expect(imported.locator('rect')).toHaveAttribute('fill', '#D7CDF5');
  await expect(imported.locator('circle')).toHaveAttribute('fill', '#D7CDF5');
});

test('active content and external SVG references are rejected before preview insertion', async ({
  page,
}) => {
  const errors: string[] = [];
  const dialogs: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('request', (request) => {
    if (request.url().includes('svg-import.invalid'))
      externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  const payloads = [
    '<script data-upload-probe="yes">alert("uploaded")</script><rect width="100" height="100" fill="red"/>',
    '<rect width="100" height="100" fill="red" onload="alert(1)"/>',
    '<image href="https://svg-import.invalid/probe.png" width="100" height="100"/>',
    '<rect width="100" height="100" fill="url(https://svg-import.invalid/probe.svg#paint)"/>',
    '<rect width="100" height="100" fill="red" clip-path="url(https://svg-import.invalid/probe.svg#cut)"/>',
    '<rect width="100" height="100" style="fill:red;filter:url(https://svg-import.invalid/probe.svg#filter)"/>',
  ];
  for (const payload of payloads) {
    await upload(
      page,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${payload}</svg>`,
    );
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('form', {
        name: 'Настройки загружаемого SVG',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('img', { name: 'Исходный SVG', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('script[data-upload-probe], svg [onload], svg image'),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
      10,
    );
  }
  expect(externalRequests).toEqual([]);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
  // A rejected upload must not poison the next import, even with the same filename.
  await upload(page, SOURCE_SVG);
  await expect(
    page.getByRole('button', { name: 'Добавить: custom', exact: true }),
  ).toBeVisible();
});

test('invalid files can be retried and uploaded library entries disappear on reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await upload(page, SOURCE_SVG, 'not-an-svg.txt', 'text/plain');
  await expect(page.getByRole('alert')).toContainText('.svg');
  await upload(page, '', 'empty.svg');
  await expect(page.getByRole('alert')).toContainText('пуст');
  await upload(page, 'x'.repeat(2 * 1024 * 1024 + 1), 'large.svg');
  await expect(page.getByRole('alert')).toContainText('2 МБ');
  await upload(page, '<svg', 'retry.svg');
  await expect(page.getByRole('alert')).toBeVisible();
  await upload(page, SOURCE_SVG, 'retry.svg');
  await page
    .getByRole('button', { name: 'Добавить: retry', exact: true })
    .click();
  await expect(
    page
      .getByLabel('Холст композиции', { exact: true })
      .locator('[data-item-id]'),
  ).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await expect(
    page.getByRole('button', {
      name: 'Добавить: retry',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByLabel('Холст композиции', { exact: true })
      .locator('[data-item-id]'),
  ).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('automatic SVG import and resulting object remain usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  await upload(page, SOURCE_SVG, 'mobile.svg');
  await expectNoHorizontalOverflow(page);
  await page
    .getByRole('button', { name: 'Добавить: mobile', exact: true })
    .click();
  await expect(
    page
      .getByRole('group', { name: 'Размер исходника объекта', exact: true })
      .getByRole('button', { name: 'S', exact: true }),
  ).toBeDisabled();
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('260');
  await width.press('Enter');
  await expect(
    page.getByRole('spinbutton', { name: 'Высота', exact: true }),
  ).toHaveValue('260');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('svg-import-scene-mobile.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Удалить выбранный', exact: true })
    .click();
  await expect(
    page
      .getByLabel('Холст композиции', { exact: true })
      .locator('[data-item-id]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Добавить: mobile',
      exact: true,
    }),
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath('svg-import-mobile.png'),
    fullPage: true,
  });
});
