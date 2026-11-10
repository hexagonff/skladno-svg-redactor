import type { KeyboardEvent } from 'react';
import type { ResizeCorner } from '../domain/objectGeometry';
import type { RotationDirection, SceneItem } from '../domain/scene';
import { RotationButtons } from './ObjectRotationControls';

const corners: readonly [ResizeCorner, string][] = [
  ['nw', 'верхний левый угол'],
  ['ne', 'верхний правый угол'],
  ['sw', 'нижний левый угол'],
  ['se', 'нижний правый угол'],
];

interface ObjectSelectionProps {
  item: SceneItem;
  width: number;
  height: number;
  sceneWidth: number;
  sceneHeight: number;
  onScaleChange: (scale: number) => void;
  layer: number;
  canRaise: boolean;
  canLower: boolean;
  onLayerChange: (direction: 'up' | 'down') => void;
  onRotate: (direction: RotationDirection) => void;
}

export function ObjectSelection({
  item,
  width,
  height,
  sceneWidth,
  sceneHeight,
  onScaleChange,
  layer,
  canRaise,
  canLower,
  onLayerChange,
  onRotate,
}: ObjectSelectionProps) {
  function changeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)
    ) {
      event.preventDefault();
      const grow = event.key === 'ArrowUp' || event.key === 'ArrowRight';
      onScaleChange(item.scale * (grow ? 1.05 : 1 / 1.05));
    }
  }

  const angle = (item.rotation * Math.PI) / 180;
  const verticalExtent =
    Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height;

  return (
    <>
      <div
        className="object-selection"
        style={{
          left: `${(item.x / sceneWidth) * 100}%`,
          top: `${(item.y / sceneHeight) * 100}%`,
          width: `${(width / sceneWidth) * 100}%`,
          height: `${(height / sceneHeight) * 100}%`,
          transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
        }}
      >
        {corners.map(([corner, name]) => (
          <button
            key={corner}
            className={`resize-handle resize-handle--${corner}`}
            data-resize-corner={corner}
            aria-label={`Изменить размер: ${name}`}
            title="Перетащите угол или используйте стрелки."
            onKeyDown={changeWithKeyboard}
            onClick={(event) => {
              if (event.detail === 0) onScaleChange(item.scale * 1.05);
            }}
          />
        ))}
      </div>
      <div
        className="object-layer-toolbar"
        data-layer-toolbar
        role="group"
        aria-label="Быстрые действия объекта"
        style={{
          left: `clamp(min(98px, 50%), ${(item.x / sceneWidth) * 100}%, max(50%, calc(100% - 98px)))`,
          top: `clamp(4px, calc(${((item.y - verticalExtent / 2) / sceneHeight) * 100}% - 42px), calc(100% - 36px))`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="На слой выше"
          title="На слой выше"
          disabled={!canRaise}
          onClick={() => onLayerChange('up')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 15V5m-4 4 4-4 4 4" />
          </svg>
        </button>
        <span
          className="object-layer-toolbar__number"
          aria-label={`Слой ${layer}`}
        >
          {layer}
        </span>
        <button
          type="button"
          aria-label="На слой ниже"
          title="На слой ниже"
          disabled={!canLower}
          onClick={() => onLayerChange('down')}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 5v10m-4-4 4 4 4-4" />
          </svg>
        </button>
        <span className="object-layer-toolbar__separator" aria-hidden="true" />
        <RotationButtons onRotate={onRotate} />
      </div>
    </>
  );
}
