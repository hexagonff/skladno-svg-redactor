import { ROTATION_STEP, type RotationDirection } from '../domain/scene';
import './ObjectRotationControls.css';

interface RotationButtonsProps {
  onRotate: (direction: RotationDirection) => void;
}

export function RotationButtons({ onRotate }: RotationButtonsProps) {
  return (
    <>
      <button
        className="rotation-button"
        type="button"
        aria-label="Повернуть против часовой стрелки"
        title={`Против часовой стрелки на ${ROTATION_STEP}°`}
        onClick={() => onRotate('counterclockwise')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3v6h6M3.5 15a9 9 0 1 0 2.1-9.4L3 9" />
        </svg>
      </button>
      <button
        className="rotation-button"
        type="button"
        aria-label="Повернуть по часовой стрелке"
        title={`По часовой стрелке на ${ROTATION_STEP}°`}
        onClick={() => onRotate('clockwise')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 3v6h-6M20.5 15a9 9 0 1 1-2.1-9.4L21 9" />
        </svg>
      </button>
    </>
  );
}

export function ObjectRotationControls({
  rotation,
  onRotate,
}: RotationButtonsProps & { rotation: number }) {
  return (
    <div className="object-rotation" role="group" aria-label="Поворот объекта">
      <h4 className="object-size__title">Поворот</h4>
      <div className="object-rotation__field">
        <div className="object-rotation__buttons">
          <RotationButtons onRotate={onRotate} />
        </div>
        <output className="object-rotation__angle" aria-label="Угол поворота">
          {rotation}°
        </output>
        <span className="field-hint">Шаг {ROTATION_STEP}°</span>
      </div>
    </div>
  );
}
