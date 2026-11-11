import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompositionCatalog } from '../../domain/composition';
import { requestComposition } from './requestComposition';

const input = {
  prompt: 'A small book and a background phone',
  catalog: createCompositionCatalog([
    { id: 'book', name: 'Book' },
    { id: 'phone', name: 'Phone' },
    { id: 'custom-1', name: 'Uploaded object' },
  ]),
};

afterEach(() => vi.unstubAllGlobals());

describe('requestComposition detail selection', () => {
  it('sends only text and catalog metadata to the local API and accepts selected independent S/L variants', async () => {
    const plan = {
      items: [
        { assetId: 'book', role: 'main', size: 'S' },
        { assetId: 'phone', role: 'bg', size: 'L' },
      ],
      message: 'Independent detail selection.',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(plan));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(requestComposition(input, controller.signal)).resolves.toEqual(
      plan,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/compose');
    expect(options).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
      signal: controller.signal,
    });
    const serialized = String(options?.body);
    expect(serialized).not.toMatch(/<svg|authorization|api[_-]?key/i);
    expect(JSON.parse(serialized)).toEqual(input);
    expect(input.catalog[0].availableSizes).toEqual(['L', 'S']);
    expect(input.catalog[2].availableSizes).toEqual(['L']);
  });

  it('rejects an unavailable S response even when the local API reports success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [{ assetId: 'custom-1', role: 'main', size: 'S' }],
        message: 'This upload has no S artwork.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestComposition(input)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown response fields and invented geometry or detail values instead of applying them', async () => {
    const invalid = [
      {
        items: [{ assetId: 'book', role: 'main', size: 'M' }],
        message: 'Invalid size.',
      },
      {
        items: [{ assetId: 'book', role: 'main', size: 'S', scale: 2 }],
        message: 'Invalid scale.',
      },
      {
        items: [
          { assetId: 'book', role: 'main', size: 'S', colors: ['#FF0000'] },
        ],
        message: 'Invalid colors.',
      },
    ];
    for (const plan of invalid) {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(plan));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        requestComposition(input),
        JSON.stringify(plan),
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});
