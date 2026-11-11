import { useState } from 'react';

interface LayerOrderControlsProps {
  layer: number;
  total: number;
  onChange: (layer: number) => void;
}

export function LayerOrderControls({
  layer,
  total,
  onChange,
}: LayerOrderControlsProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);

  function commit() {
    if (draft === null) return;
    const value = draft.trim() === '' ? Number.NaN : Number(draft);
    if (!Number.isInteger(value) || value < 1 || value > total) {
      setDraft(null);
      setError(true);
      return;
    }
    onChange(value);
    setDraft(null);
    setError(false);
  }

  return (
    <div className="layer-order">
      <label className="field-label" htmlFor="layer-order-input">
        Порядок слоя
      </label>
      <div className="layer-order__field">
        <input
          id="layer-order-input"
          type="number"
          min={1}
          max={total}
          step={1}
          inputMode="numeric"
          value={draft ?? layer}
          aria-invalid={error}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(false);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
              setError(false);
            }
          }}
        />
        <span>из {total}</span>
      </div>
      <p className="field-hint">Чем больше номер, тем выше объект.</p>
      {error && (
        <p className="dimension-field__error" role="alert">
          Введите целое число от 1 до {total}.
        </p>
      )}
    </div>
  );
}
