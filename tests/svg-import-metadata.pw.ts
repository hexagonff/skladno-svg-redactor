import { readFile, writeFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { expect, test, type Page } from '@playwright/test';

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:c2pa="http://c2pa.org/manifest"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="300" height="150" viewBox="10 20 300 150"
  inkscape:version="1.4" sodipodi:docname="editor-export.svg"
  c2pa:manifest="urn:example:manifest" data-exporter="editor"
  aria-labelledby="original-title" role="img" class="editor-artwork">
  <title id="original-title">Исходный рисунок</title>
  <desc>Описание из графического редактора.</desc>
  <metadata>
    <rdf:RDF><rdf:Description rdf:about="original.svg">
      <c2pa:manifest>Служебная информация #ABCDEF</c2pa:manifest>
    </rdf:Description></rdf:RDF>
  </metadata>
  <defs><clipPath id="cut"><rect x="10" y="20" width="300" height="150" fill="white"/></clipPath></defs>
  <g clip-path="url(#cut)" inkscape:label="Drawing" data-layer="objects" aria-label="Geometry">
    <rect x="10" y="20" width="300" height="150" fill="#D7CDF5"/>
    <path d="M30 40 L100 40 L60 100 Z" fill="#F9ECB0" opacity="0.75"/>
  </g>
</svg>`;

async function upload(page: Page, source: string) {
  await page.getByLabel('Файл SVG', { exact: true }).setInputFiles({
    name: 'metadata.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source, 'utf8'),
  });
}

function expectCleanVector(source: string) {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  for (const name of [
    'metadata',
    'title',
    'desc',
    'script',
    'image',
    'style',
  ]) {
    expect(document.getElementsByTagName(name).length).toBe(0);
  }
  const elements = Array.from(document.getElementsByTagName('*'));
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name).not.toMatch(
        /^(?:xmlns:|inkscape:|sodipodi:|c2pa:|rdf:|data-exporter$|data-layer$|aria-|class$|role$)/,
      );
    }
  }
  expect(source).not.toContain('urn:example:manifest');
  expect(source).not.toContain('#ABCDEF');
}

test('editor namespaces and inert metadata are removed without changing imported geometry or source file', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  const sourcePath = testInfo.outputPath('editor-export.svg');
  await writeFile(sourcePath, SOURCE_SVG, 'utf8');
  await page.getByLabel('Файл SVG', { exact: true }).setInputFiles(sourcePath);
  const add = page.getByRole('button', {
    name: 'Добавить: editor-export',
    exact: true,
  });
  await expect(add).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('form')).toHaveCount(0);
  const preview = add.locator('svg');
  await expect(preview).toHaveAttribute('viewBox', '10 20 300 150');
  await expect(preview).toHaveAttribute('width', '300');
  await expect(preview).toHaveAttribute('height', '150');
  await expect(preview.locator('g > rect')).toHaveAttribute('fill', '#D7CDF5');
  await expect(preview.locator('path')).toHaveAttribute('fill', '#F9ECB0');
  await expect(preview.locator('path')).toHaveAttribute(
    'd',
    'M30 40 L100 40 L60 100 Z',
  );
  await expect(preview.locator('path')).toHaveAttribute('opacity', '0.75');
  expectCleanVector(await preview.evaluate((svg) => svg.outerHTML));
  await add.click();
  const canvas = page.getByLabel('Холст композиции', { exact: true });
  const imported = canvas.locator('[data-asset-id^="custom-"] > svg');
  await expect(imported).toHaveCount(1);
  await expect(imported).toHaveAttribute('viewBox', '10 20 300 150');
  await expect(imported.locator('g > rect')).toHaveAttribute('fill', '#D7CDF5');
  await expect(imported.locator('path')).toHaveAttribute('fill', '#F9ECB0');
  await expect(imported.locator('path')).toHaveAttribute(
    'd',
    'M30 40 L100 40 L60 100 Z',
  );
  await expect(imported.locator('path')).toHaveAttribute('opacity', '0.75');
  await page
    .getByRole('combobox', { name: 'Палитра', exact: true })
    .selectOption('orange');
  await expect(imported.locator('g > rect')).toHaveAttribute('fill', '#FDD7B9');
  await expect(imported.locator('path')).toHaveAttribute('fill', '#F9ECB0');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать SVG', exact: true }).click();
  const downloadPath = await (await downloadEvent).path();
  expect(downloadPath).not.toBeNull();
  const exported = await readFile(downloadPath!, 'utf8');
  expectCleanVector(exported);
  expect(exported).toContain('M30 40 L100 40 L60 100 Z');
  expect(exported).toContain('viewBox="10 20 300 150"');
  expect(exported).toContain('fill="#FDD7B9"');
  expect(await readFile(sourcePath, 'utf8')).toBe(SOURCE_SVG);
  expect(errors).toEqual([]);
});

test('editor namespace declarations do not permit active content or external references', async ({
  page,
}) => {
  const dialogs: string[] = [];
  const externalRequests: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('request', (request) => {
    if (request.url().includes('svg-metadata.invalid'))
      externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
    10,
  );
  for (const content of [
    '<script>alert("unsafe")</script><rect width="100" height="100" fill="red"/>',
    '<rect width="100" height="100" fill="red" onload="alert(1)"/>',
    '<rect width="100" height="100" fill="url(https://svg-metadata.invalid/paint.svg#paint)"/>',
    '<rect width="100" height="100" fill="red" clip-path="url(https://svg-metadata.invalid/clip.svg#clip)"/>',
    '<use xlink:href="https://svg-metadata.invalid/object.svg#shape"/>',
  ]) {
    await upload(
      page,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:c2pa="http://c2pa.org/manifest" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><metadata><c2pa:manifest>Inert</c2pa:manifest></metadata>${content}</svg>`,
    );
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('form', {
        name: 'Настройки загружаемого SVG',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Добавить:/ })).toHaveCount(
      10,
    );
  }
  expect(dialogs).toEqual([]);
  expect(externalRequests).toEqual([]);
});
