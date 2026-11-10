import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ColorMap } from '../domain/colors';
import { assignImportedColorRoles } from '../domain/importColors';
import type { ColorScheme } from '../domain/library';
import {
  inspectImportedSvg,
  MAX_SVG_BYTES,
  type InspectedImportedSvg,
} from '../services/svg/importSvg';
import './SvgImportPanel.css';

interface SvgImportPanelProps {
  scheme: ColorScheme;
  onImport: (
    name: string,
    inspected: InspectedImportedSvg,
    colors: ColorMap,
  ) => void;
}

export function SvgImportPanel({ scheme, onImport }: SvgImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attemptRef = useRef(0);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(
    () => () => {
      attemptRef.current += 1;
    },
    [],
  );

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const attempt = ++attemptRef.current;
    setError('');
    setMessage('');
    setReading(false);
    if (!/\.svg$/i.test(file.name)) {
      setError('Выберите файл с расширением .svg.');
      return;
    }
    if (file.size > MAX_SVG_BYTES) {
      setError('Файл SVG должен быть не больше 2 МБ.');
      return;
    }
    setReading(true);
    try {
      const inspected = inspectImportedSvg(await file.text());
      if (attempt !== attemptRef.current) return;
      const { colorMap, mergedColorCount } = assignImportedColorRoles(
        inspected.colors,
        scheme.colors,
      );
      const name =
        file.name
          .replace(/\.svg$/i, '')
          .trim()
          .slice(0, 80) || 'Свой SVG';
      onImport(name, inspected, colorMap);
      setMessage(
        `«${name}» добавлен в библиотеку. Распознано цветов: ${inspected.colors.length}. Нажмите на объект, чтобы добавить на холст.${mergedColorCount ? ' Оттенков больше, чем в палитре; некоторые цвета объединены.' : ''}`,
      );
    } catch (failure) {
      if (attempt === attemptRef.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Не удалось добавить SVG.',
        );
    } finally {
      if (attempt === attemptRef.current) setReading(false);
    }
  }

  return (
    <section className="svg-import" aria-label="Загрузка SVG">
      <input
        ref={inputRef}
        className="svg-import__file"
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="Файл SVG"
        onChange={readFile}
      />
      <button
        className="button svg-import__open"
        type="button"
        disabled={reading}
        onClick={() => inputRef.current?.click()}
      >
        {reading ? 'Читаем SVG…' : 'Загрузить SVG'}
      </button>
      <p className="field-hint">
        До 2 МБ. Загруженные объекты исчезнут после перезагрузки страницы.
      </p>
      <p className="field-hint">
        Цвета подбираются автоматически по текущей палитре.
      </p>
      <p className="field-hint">
        Контуры и фигуры, без растра, текста и градиентов.
      </p>
      {error && (
        <p className="svg-import__error" role="alert">
          {error}
        </p>
      )}
      <p className="svg-import__status" role="status">
        {message}
      </p>
    </section>
  );
}
