import { handleCompose, type ComposeEnv } from './compose';

export interface WorkerEnv extends ComposeEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/compose') return handleCompose(request, env);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return Response.json(
        { error: 'API route not found.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
