import {
  validateCompositionPlan,
  validateCompositionRequest,
  type CompositionPlan,
  type CompositionRequest,
} from '../../domain/composition';

/** The API key stays on the server; this request contains text and catalog metadata only. */
export async function requestComposition(
  input: CompositionRequest,
  signal?: AbortSignal,
): Promise<CompositionPlan> {
  const request = validateCompositionRequest(input);
  let response: Response;
  try {
    response = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.',
      { cause: error },
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.');
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string' &&
      body.error.length <= 600
        ? body.error
        : undefined;
    throw new Error(
      message || 'Не удалось собрать композицию. Попробуйте позже.',
    );
  }
  return validateCompositionPlan(body, request.catalog);
}
