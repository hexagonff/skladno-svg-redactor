import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { CatalogObject } from '../domain/catalog';
import {
  createCompositionCatalog,
  type CompositionPlan,
} from '../domain/composition';
import { requestComposition } from '../services/ai';
import './AiComposer.css';

export interface AiComposerProps {
  catalog: readonly CatalogObject[];
  onApply: (plan: CompositionPlan) => void;
}

export function AiComposer({ catalog, onApply }: AiComposerProps) {
  const id = useId();
  const attemptRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      attemptRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const description = prompt.trim();
    if (!description || controllerRef.current) return;
    const attempt = ++attemptRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError('');
    setMessage('Подбираем объекты и собираем композицию…');
    try {
      const plan = await requestComposition(
        { prompt: description, catalog: createCompositionCatalog(catalog) },
        controller.signal,
      );
      if (attempt !== attemptRef.current) return;
      if (plan.items.length === 0) {
        setMessage(
          plan.message || 'Подходящие объекты не найдены. Уточните описание.',
        );
        return;
      }
      onApply(plan);
      setMessage(
        plan.message || `Композиция собрана. Объектов: ${plan.items.length}.`,
      );
    } catch (failure) {
      if (attempt !== attemptRef.current) return;
      setMessage('');
      setError(
        failure instanceof Error
          ? failure.message
          : 'Не удалось собрать композицию. Попробуйте ещё раз.',
      );
    } finally {
      if (attempt === attemptRef.current) {
        controllerRef.current = null;
        setPending(false);
      }
    }
  }

  function cancel() {
    attemptRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPending(false);
    setError('');
    setMessage('Сборка отменена. Холст не изменён.');
  }

  return (
    <section className="aicomposer" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="aicomposer__heading">
        Собрать по описанию
      </h2>
      <form onSubmit={submit} aria-busy={pending}>
        <label className="aicomposer__label" htmlFor={`${id}-prompt`}>
          Описание композиции
        </label>
        <textarea
          id={`${id}-prompt`}
          className="aicomposer__prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder="Например: готовлюсь к экзамену"
          maxLength={1000}
          rows={3}
          disabled={pending}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="field-hint">
          Новая композиция заменит объекты на холсте. Фон и палитра сохранятся.
        </p>
        <button
          className="button button--primary aicomposer__submit"
          type="submit"
          disabled={pending || !prompt.trim()}
        >
          {pending ? 'Собираем…' : 'Собрать композицию'}
        </button>
        {pending && (
          <button
            className="button aicomposer__cancel"
            type="button"
            onClick={cancel}
          >
            Отменить сборку
          </button>
        )}
      </form>
      {error && (
        <p className="aicomposer__error" role="alert">
          {error}
        </p>
      )}
      <p className="aicomposer__status" role="status">
        {message}
      </p>
    </section>
  );
}
