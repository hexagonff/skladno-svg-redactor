import { describe, expect, it, vi } from 'vitest';
import { OBJECT_CATALOG } from '../src/domain/catalog';
import { createCompositionCatalog } from '../src/domain/composition';
import { handleCompose } from './compose';

const env = { OPENROUTER_API_KEY: 'test-provider-key' };
const catalog = createCompositionCatalog([
  { id: 'book', name: 'Book' },
  { id: 'phone', name: 'Phone' },
  { id: 'puzzle', name: 'Puzzle' },
  { id: 'custom-1', name: 'Uploaded object' },
]);
const input = { prompt: 'Arrange these objects', catalog };
const mixedPlan = {
  items: [
    { assetId: 'book', role: 'main', size: 'S' },
    { assetId: 'phone', role: 'bg', size: 'L' },
  ],
  message: 'Selected independent detail variants.',
};

function request(body: unknown = input): Request {
  return new Request('http://localhost/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function provider(plan: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      choices: [
        { message: { content: JSON.stringify(plan) }, finish_reason: 'stop' },
      ],
    }),
  );
}

function messages(fetchMock: ReturnType<typeof provider>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
    messages: { role: string; content: string }[];
  };
  return {
    system: body.messages.find((entry) => entry.role === 'system')!.content,
    user: JSON.parse(
      body.messages.find((entry) => entry.role === 'user')!.content,
    ) as typeof input,
  };
}

describe('composition API detail selection', () => {
  it('forwards canonical available sizes and asks the provider to choose detail and role for each object', async () => {
    const fetchMock = provider(mixedPlan);
    const response = await handleCompose(
      request({
        ...input,
        catalog: input.catalog.map((entry) => ({
          ...entry,
          name: entry.id === 'custom-1' ? entry.name : 'Forged builtin name',
          description: 'Forged description',
          availableSizes: entry.id === 'custom-1' ? ['L', 'S'] : ['L'],
        })),
      }),
      env,
      { fetch: fetchMock },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mixedPlan);
    const forwarded = messages(fetchMock);
    expect(forwarded.system).toContain('availableSizes');
    expect(forwarded.system).toMatch(/"size"\s*:\s*"[LS]"/);
    expect(forwarded.system).toContain('main');
    expect(forwarded.system).toContain('bg');
    expect(forwarded.user).toEqual(input);
    expect(forwarded.user.catalog[0].availableSizes).toEqual(['L', 'S']);
    expect(forwarded.user.catalog[3].availableSizes).toEqual(['L']);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('accepts three background objects without requiring a main object', async () => {
    const plan = {
      items: [
        { assetId: 'book', role: 'bg', size: 'S' },
        { assetId: 'phone', role: 'bg', size: 'L' },
        { assetId: 'puzzle', role: 'bg', size: 'S' },
      ],
      message: 'An entirely background composition.',
    };
    const response = await handleCompose(request(), env, {
      fetch: provider(plan),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(plan);
  });

  it('rejects an invented S variant for an upload even when the browser advertises it', async () => {
    const fetchMock = provider({
      items: [{ assetId: 'custom-1', role: 'main', size: 'S' }],
      message: 'Unavailable uploaded detail.',
    });
    const response = await handleCompose(
      request({
        ...input,
        catalog: input.catalog.map((entry) => ({
          ...entry,
          availableSizes: ['L', 'S'],
        })),
      }),
      env,
      { fetch: fetchMock },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(messages(fetchMock).user.catalog[3].availableSizes).toEqual(['L']);
  });

  it('rejects provider-invented sizes, geometry, artwork and scene settings', async () => {
    const invalid = [
      { ...mixedPlan, items: [{ assetId: 'book', role: 'main', size: 'M' }] },
      { ...mixedPlan, items: [{ ...mixedPlan.items[0], scale: 2 }] },
      { ...mixedPlan, items: [{ ...mixedPlan.items[0], x: 20, rotation: 30 }] },
      { ...mixedPlan, items: [{ ...mixedPlan.items[0], svg: '<svg/>' }] },
      { ...mixedPlan, canvasSize: 'S' },
    ];
    for (const plan of invalid) {
      const response = await handleCompose(request(), env, {
        fetch: provider(plan),
      });
      expect(response.status, JSON.stringify(plan)).toBe(502);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    }
  });

  it('normalizes legacy provider plans without size to L', async () => {
    const response = await handleCompose(request(), env, {
      fetch: provider({
        items: [{ assetId: 'book', role: 'main' }],
        message: 'Legacy plan.',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ assetId: 'book', role: 'main', size: 'L' }],
      message: 'Legacy plan.',
    });
  });

  it('keeps the limit of six objects while allowing any mix of roles', async () => {
    const seven = createCompositionCatalog(OBJECT_CATALOG.slice(0, 7));
    const response = await handleCompose(
      request({ ...input, catalog: seven }),
      env,
      {
        fetch: provider({
          items: seven.map(({ id }) => ({
            assetId: id,
            role: 'bg',
            size: 'S',
          })),
          message: 'Too many objects.',
        }),
      },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});

describe('native source size metadata', () => {
  it('forwards the selected canvas while replacing forged builtin dimensions with real source sizes', async () => {
    const fetchMock = provider(mixedPlan);
    const response = await handleCompose(
      request({
        ...input,
        canvas: { width: 500, height: 500 },
        catalog: input.catalog.map((entry) => ({
          ...entry,
          sourceSizes: {
            L: { width: 1, height: 1 },
            S: { width: 2, height: 2 },
          },
        })),
      }),
      env,
      { fetch: fetchMock },
    );
    expect(response.status).toBe(200);
    const forwarded = messages(fetchMock).user as typeof input & {
      canvas: { width: number; height: number };
    };
    expect(forwarded.canvas).toEqual({ width: 500, height: 500 });
    expect(
      forwarded.catalog.find((entry) => entry.id === 'book')!.sourceSizes,
    ).toEqual({
      L: { width: 1446, height: 977 },
      S: { width: 723, height: 489 },
    });
    expect(
      forwarded.catalog.find((entry) => entry.id === 'custom-1')!.sourceSizes,
    ).toEqual({ L: { width: 1, height: 1 } });
  });
});
