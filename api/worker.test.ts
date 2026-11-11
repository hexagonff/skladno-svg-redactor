import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompositionCatalog } from '../src/domain/composition';
import worker, { type WorkerEnv } from './worker';

function environment(): WorkerEnv {
  return {
    OPENROUTER_API_KEY: 'worker-test-secret',
    OPENROUTER_MODEL: 'openrouter/free',
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('static asset')) },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Worker routing', () => {
  it('uses the server secret for compose while returning only a validated plan', async () => {
    const env = environment();
    const plan = {
      items: [{ assetId: 'book', role: 'bg', size: 'S' }],
      message: 'A book from the catalog.',
    };
    const provider = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(plan) },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', provider);
    const response = await worker.fetch(
      new Request('https://skladno.example/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Book',
          catalog: createCompositionCatalog([{ id: 'book', name: 'Book' }]),
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual(plan);
    expect(body).not.toContain(env.OPENROUTER_API_KEY);
    expect(provider.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer worker-test-secret',
    });
    expect(JSON.parse(String(provider.mock.calls[0][1]?.body)).model).toBe(
      'openrouter/free',
    );
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('retains method validation instead of serving the SPA for compose GET requests', async () => {
    const env = environment();
    const response = await worker.fetch(
      new Request('https://skladno.example/api/compose'),
      env,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each(['/api', '/api/missing'])(
    'returns a JSON 404 for unknown endpoint %s',
    async (path) => {
      const env = environment();
      const response = await worker.fetch(
        new Request('https://skladno.example' + path),
        env,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain(
        'application/json',
      );
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    },
  );

  it('passes static requests to the asset binding unchanged', async () => {
    const env = environment();
    const request = new Request('https://skladno.example/assets/example.json');
    const response = await worker.fetch(request, env);
    expect(await response.text()).toBe('static asset');
    expect(env.ASSETS.fetch).toHaveBeenCalledExactlyOnceWith(request);
  });
});
