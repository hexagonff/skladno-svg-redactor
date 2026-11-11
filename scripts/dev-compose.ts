import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/** Run the same serverless handler during `npm run dev`; env stays server-side. */
export function composeApi(env: Record<string, string>): Plugin {
  return {
    name: 'local-compose-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost')
          .pathname;
        if (pathname !== '/api/compose') {
          next();
          return;
        }
        try {
          const module = await server.ssrLoadModule('/api/compose.ts');
          const createHandler = module.createComposeHandler as (
            env: Record<string, string>,
          ) => (
            request: IncomingMessage,
            response: ServerResponse,
          ) => Promise<void>;
          await createHandler(env)(request, response);
        } catch {
          // Do not expose module diagnostics, request data, or environment values.
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader(
              'Content-Type',
              'application/json; charset=utf-8',
            );
            response.setHeader('Cache-Control', 'no-store');
          }
          response.end(
            JSON.stringify({
              error:
                '?? ??????? ????????? ?????? ??????????. ?????????? ??? ???.',
            }),
          );
        }
      });
    },
  };
}
