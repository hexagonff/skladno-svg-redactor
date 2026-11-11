import { expect, test, type Page, type Route } from '@playwright/test';

const COMPOSE_URL = '**/api/compose';
const STUDY_PLAN = {
  items: [
    { assetId: 'book', role: 'main' },
    { assetId: 'lamp', role: 'bg' },
    { assetId: 'phone', role: 'main' },
  ],
  message: 'Собрана композиция для учёбы: книга, лампа и телефон.',
};

function composer(page: Page) {
  return page.getByRole('region', { name: 'Собрать по описанию', exact: true });
}

function canvas(page: Page) {
  return page.getByLabel('Холст композиции', { exact: true });
}

function promptInput(page: Page) {
  return composer(page).getByRole('textbox', {
    name: 'Описание композиции',
    exact: true,
  });
}

function submitButton(page: Page) {
  return composer(page).getByRole('button', {
    name: 'Собрать композицию',
    exact: true,
  });
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function canvasSvg(page: Page) {
  return canvas(page)
    .locator(':scope > svg')
    .evaluate((element) => element.outerHTML);
}

test('description selects existing objects, keeps fixed sizes, background and palette, and sends no SVG or API key', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let received: Record<string, unknown> | undefined;
  await page.route(COMPOSE_URL, async (route) => {
    received = route.request().postDataJSON() as Record<string, unknown>;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()).not.toHaveProperty('authorization');
    await fulfill(route, STUDY_PLAN);
  });
  await page.goto('/');
  await page.getByLabel('Файл SVG', { exact: true }).setInputFiles({
    name: 'Будильник.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#181817"/></svg>',
    ),
  });
  await expect(
    page.getByRole('button', { name: 'Добавить: Будильник', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const originalId = await canvas(page)
    .locator('[data-item-id]')
    .getAttribute('data-item-id');
  await page
    .getByRole('combobox', { name: 'Фон', exact: true })
    .selectOption('canvas2');
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('teal');
  await promptInput(page).fill('  Готовлюсь к экзамену  ');
  await submitButton(page).click();
  await expect(composer(page).getByRole('status')).toHaveText(
    STUDY_PLAN.message,
  );
  expect(received).toBeDefined();
  expect(received!.prompt).toBe('Готовлюсь к экзамену');
  expect(Object.keys(received!).sort()).toEqual(['catalog', 'prompt']);
  expect(received!.catalog).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'book',
        name: 'Книга',
        description: expect.any(String),
      }),
      expect.objectContaining({
        id: 'custom-1',
        name: 'Будильник',
        description: expect.any(String),
      }),
    ]),
  );
  expect(JSON.stringify(received)).not.toMatch(
    /<svg|<path|Bearer|api[_-]?key/i,
  );
  const items = canvas(page).locator('[data-item-id]');
  await expect(items).toHaveCount(3);
  expect(
    await items.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-asset-id')).sort(),
    ),
  ).toEqual(['book', 'lamp', 'phone']);
  expect(
    await items.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-item-id')),
    ),
  ).not.toContain(originalId);
  for (const item of await items.all()) {
    await expect(item).toHaveAttribute('data-detail-size', 'L');
    await expect(item).toHaveAttribute(
      'transform',
      /rotate\(0\) scale\(0\.35\)/,
    );
  }
  const translations = await items.evaluateAll((elements) =>
    elements.map(
      (element) =>
        element.getAttribute('transform')!.match(/^translate\(([^)]+)\)/)![1],
    ),
  );
  expect(new Set(translations).size).toBe(3);
  await expect(canvas(page).locator('[data-canvas-id]')).toHaveAttribute(
    'data-canvas-id',
    'canvas2',
  );
  await expect(
    page.getByRole('combobox', { name: 'Палитра', exact: true }),
  ).toHaveValue('teal');
  const lampPaints = await canvas(page)
    .locator('[data-asset-id="lamp"]')
    .evaluate((element) =>
      [...element.querySelectorAll('*')]
        .filter((node) => !node.closest('defs,clipPath'))
        .flatMap((node) =>
          ['fill', 'stroke'].map((attribute) => node.getAttribute(attribute)),
        )
        .filter((paint): paint is string => paint !== null && paint !== 'none'),
    );
  expect(lampPaints.length).toBeGreaterThan(0);
  expect(
    lampPaints.every((paint) =>
      ['#BEEBEB', '#80DADA', '#5ABEBE'].includes(paint),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: /^Выбрать: Лампа,/ }).click();
  await expect(
    page.getByRole('button', { name: 'Фоновый', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await canvasSvg(page)).not.toMatch(
    /<image|foreignObject|<style|var\s*\(/,
  );
  expect(pageErrors).toEqual([]);
});

test('API errors preserve the complete scene and description and allow retry', async ({
  page,
}) => {
  let requests = 0;
  await page.route(COMPOSE_URL, async (route) => {
    requests += 1;
    await fulfill(
      route,
      requests === 1
        ? { error: 'Для сборки задайте OPENROUTER_API_KEY на сервере.' }
        : STUDY_PLAN,
      requests === 1 ? 503 : 200,
    );
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const before = await canvasSvg(page);
  await expect(submitButton(page)).toBeDisabled();
  await promptInput(page).fill('   ');
  await expect(submitButton(page)).toBeDisabled();
  await promptInput(page).fill('Хочу учиться');
  await submitButton(page).click();
  await expect(composer(page).getByRole('alert')).toHaveText(
    'Для сборки задайте OPENROUTER_API_KEY на сервере.',
  );
  expect(await canvasSvg(page)).toBe(before);
  await expect(promptInput(page)).toHaveValue('Хочу учиться');
  await expect(submitButton(page)).toBeEnabled();
  await submitButton(page).click();
  await expect(composer(page).getByRole('alert')).toHaveCount(0);
  await expect(composer(page).getByRole('status')).toHaveText(
    STUDY_PLAN.message,
  );
  await expect(canvas(page).locator('[data-item-id]')).toHaveCount(3);
  expect(requests).toBe(2);
});

test('cancellation prevents late responses from overwriting the next composition', async ({
  page,
}) => {
  let releaseFirst!: () => void;
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let finishFirst!: () => void;
  const firstFinished = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  let requests = 0;
  await page.route(COMPOSE_URL, async (route) => {
    requests += 1;
    if (requests === 1) {
      await firstReleased;
      try {
        await fulfill(route, STUDY_PLAN);
      } catch {
        /* The cancelled request may already be closed. */
      } finally {
        finishFirst();
      }
      return;
    }
    await fulfill(route, {
      items: [{ assetId: 'phone', role: 'main' }],
      message: 'Новая композиция: телефон.',
    });
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Кошелёк', exact: true })
    .click();
  const before = await canvasSvg(page);
  await promptInput(page).fill('Первый запрос');
  await submitButton(page).click();
  await expect(composer(page).getByRole('status')).toHaveText(
    'Подбираем объекты и собираем композицию…',
  );
  await expect.poll(() => requests).toBe(1);
  await expect(promptInput(page)).toBeDisabled();
  await expect(
    composer(page).getByRole('button', { name: 'Собираем…', exact: true }),
  ).toBeDisabled();
  await composer(page)
    .getByRole('button', { name: 'Отменить сборку', exact: true })
    .click();
  await expect(composer(page).getByRole('status')).toHaveText(
    'Сборка отменена. Холст не изменён.',
  );
  expect(await canvasSvg(page)).toBe(before);
  await promptInput(page).fill('Второй запрос');
  await submitButton(page).click();
  await expect(composer(page).getByRole('status')).toHaveText(
    'Новая композиция: телефон.',
  );
  releaseFirst();
  await firstFinished;
  await expect(canvas(page).locator('[data-item-id]')).toHaveCount(1);
  await expect(canvas(page).locator('[data-item-id]')).toHaveAttribute(
    'data-asset-id',
    'phone',
  );
  await expect(composer(page).getByRole('status')).toHaveText(
    'Новая композиция: телефон.',
  );
});

test('empty or invalid AI choices leave existing objects unchanged', async ({
  page,
}) => {
  let requests = 0;
  await page.route(COMPOSE_URL, async (route) => {
    requests += 1;
    await fulfill(
      route,
      requests === 1
        ? {
            items: [],
            message: 'В библиотеке нет подходящих объектов. Уточните описание.',
          }
        : {
            items: [{ assetId: 'not-in-catalog', role: 'main' }],
            message: 'Неверный объект.',
          },
    );
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Добавить: Книга', exact: true })
    .click();
  const before = await canvasSvg(page);
  await promptInput(page).fill('Космический корабль');
  await submitButton(page).click();
  await expect(composer(page).getByRole('status')).toHaveText(
    'В библиотеке нет подходящих объектов. Уточните описание.',
  );
  expect(await canvasSvg(page)).toBe(before);
  await submitButton(page).click();
  await expect(composer(page).getByRole('alert')).toBeVisible();
  expect(await canvasSvg(page)).toBe(before);
  await expect(composer(page).getByRole('status')).toBeEmpty();
});

test('composer supports keyboard submission and fits a narrow viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.route(COMPOSE_URL, (route) => fulfill(route, STUDY_PLAN));
  await page.goto('/');
  await promptInput(page).fill('Книга и телефон для учёбы');
  await expect(promptInput(page)).toHaveAttribute('maxlength', '1000');
  await submitButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(composer(page).getByRole('status')).toHaveText(
    STUDY_PLAN.message,
  );
  await expect(canvas(page).locator('[data-item-id]')).toHaveCount(3);
  await expect(composer(page).getByRole('alert')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('ai-composer-mobile.png'),
    fullPage: true,
  });
});
