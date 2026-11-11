import { useMemo, useState } from 'react';
import type { ColorRole } from '../domain/colors';
import type { ColorScheme, LibraryAsset } from '../domain/library';
import { getEditableColorRoles } from '../domain/objectColors';
import type { SceneItem } from '../domain/scene';
import { getAssetColorRoles } from '../services/svg/getAssetColorRoles';

interface ObjectColorControlsProps {
  asset: LibraryAsset;
  item: SceneItem;
  scheme: ColorScheme;
  onChange: (source: ColorRole, target: ColorRole) => void;
  onReset: () => void;
}

export function ObjectColorControls({
  asset,
  item,
  scheme,
  onChange,
  onReset,
}: ObjectColorControlsProps) {
  const sourceRoles = useMemo(
    () => getAssetColorRoles(asset, item.role),
    [asset, item.role],
  );
  const [chosenSource, setChosenSource] = useState<ColorRole>();
  const source =
    chosenSource && sourceRoles.includes(chosenSource)
      ? chosenSource
      : sourceRoles[0];
  const overrides = item.colorOverrides?.[item.role];
  const target = source ? (overrides?.[source] ?? source) : undefined;
  const availableRoles = getEditableColorRoles(item.role);
  const changed = Object.keys(overrides ?? {}).length > 0;

  if (!source) return null;

  return (
    <div className="object-colors">
      <h4 className="object-colors__title">Цвета объекта</h4>
      <p className="field-hint">
        Выберите участок по его цвету, затем новый оттенок.
      </p>
      <p className="object-colors__label">Используемые цвета</p>
      <div
        className="color-options"
        role="group"
        aria-label="Используемые цвета"
      >
        {sourceRoles.map((role, index) => {
          const color = scheme.colors[overrides?.[role] ?? role];
          return (
            <button
              className="color-option"
              key={role}
              aria-label={`Участок ${index + 1}`}
              aria-pressed={source === role}
              title={`Участок ${index + 1}: ${color}`}
              onClick={() => setChosenSource(role)}
            >
              <span
                className="color-option__paint"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className="color-option__number" aria-hidden="true">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
      <p className="object-colors__label">Заменить на:</p>
      <div className="color-options" role="group" aria-label="Заменить на:">
        {availableRoles.map((role, index) => (
          <button
            className="color-option"
            key={role}
            aria-label={`Цвет ${index + 1}`}
            aria-pressed={target === role}
            title={scheme.colors[role]}
            onClick={() => onChange(source, role)}
          >
            <span
              className="color-option__paint"
              style={{ backgroundColor: scheme.colors[role] }}
              aria-hidden="true"
            />
            {target === role && (
              <span className="color-option__check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
      {item.role === 'bg' && (
        <p className="field-hint">
          Для фонового объекта — только оттенки фона.
        </p>
      )}
      <button
        className="object-colors__reset"
        disabled={!changed}
        onClick={onReset}
      >
        Сбросить цвета
      </button>
    </div>
  );
}
