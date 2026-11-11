import { useState, type KeyboardEvent } from 'react';

interface ObjectSizeControlsProps {
  width: number;
  height: number;
  onChange: (dimension: 'width' | 'height', value: number) => void;
}

function formatDimension(value: number): string {
  return value >= 0.01
    ? String(Number(value.toFixed(2)))
    : value.toPrecision(2);
}

function DimensionInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);

  function commit() {
    if (draft === null) return;
    const next = draft.trim() === '' ? Number.NaN : Number(draft);
    if (!Number.isFinite(next) || next <= 0) {
      setError(true);
      setDraft(null);
      return;
    }
    try {
      onCommit(next);
      setError(false);
    } catch {
      setError(true);
    }
    setDraft(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      setError(false);
    }
  }

  return (
    <label className="dimension-field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={draft ?? formatDimension(value)}
        aria-label={label}
        aria-invalid={error}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(false);
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
      {error && (
        <span className="dimension-field__error" role="alert">
          Введите число больше нуля.
        </span>
      )}
    </label>
  );
}

export function ObjectSizeControls({
  width,
  height,
  onChange,
}: ObjectSizeControlsProps) {
  return (
    <div className="object-size" role="group" aria-label="Размер объекта">
      <h4 className="object-size__title">Размер</h4>
      <div className="dimension-fields">
        <DimensionInput
          label="Ширина"
          value={width}
          onCommit={(value) => onChange('width', value)}
        />
        <DimensionInput
          label="Высота"
          value={height}
          onCommit={(value) => onChange('height', value)}
        />
      </div>
      <p className="field-hint">Пропорции сохраняются.</p>
    </div>
  );
}
