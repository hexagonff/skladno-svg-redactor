import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { SceneItem } from '../domain/scene';
import './LayerList.css';

interface LayerListProps {
  items: readonly SceneItem[];
  selectedItemId: string | null;
  objectNames: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
  onReorder: (id: string, layer: number) => void;
}

interface DragPreview {
  id: string;
  beforeId: string | null;
  layer: number;
}

interface LayerDrag {
  id: string;
  pointerId: number;
  sourceLayer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  list: HTMLOListElement;
  scrollContainer: HTMLElement | null;
  frame: number | null;
  frameTime: number | null;
  preview: DragPreview | null;
}

function layerRows(list: HTMLOListElement): HTMLElement[] {
  return Array.from(
    list.querySelectorAll<HTMLElement>(':scope > [data-layer-id]'),
  );
}

function findScrollContainer(list: HTMLElement): HTMLElement | null {
  const panel = list.closest<HTMLElement>('.settings-panel');
  if (panel && /(auto|scroll)/.test(getComputedStyle(panel).overflowY))
    return panel;
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : null;
}

function stopCapture(drag: LayerDrag): void {
  if (drag.frame !== null) cancelAnimationFrame(drag.frame);
  if (drag.list.hasPointerCapture(drag.pointerId)) {
    drag.list.releasePointerCapture(drag.pointerId);
  }
}

export function LayerList({
  items,
  selectedItemId,
  objectNames,
  onSelect,
  onReorder,
}: LayerListProps) {
  const dragRef = useRef<LayerDrag | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(
    () => () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag) stopCapture(drag);
    },
    [],
  );

  function updateTarget(drag: LayerDrag) {
    if (
      Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4 &&
      !drag.preview
    )
      return;
    const rows = layerRows(drag.list);
    const others = rows.filter((row) => row.dataset.layerId !== drag.id);
    let insertionIndex = others.findIndex((row) => {
      const bounds = row.getBoundingClientRect();
      return drag.y < bounds.top + bounds.height / 2;
    });
    if (insertionIndex === -1) insertionIndex = others.length;
    const next: DragPreview = {
      id: drag.id,
      beforeId: others[insertionIndex]?.dataset.layerId ?? null,
      layer: rows.length - insertionIndex,
    };
    if (
      !drag.preview ||
      next.layer !== drag.preview.layer ||
      next.beforeId !== drag.preview.beforeId
    ) {
      drag.preview = next;
      setPreview(next);
    }
  }

  function endDrag(commit: boolean) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    stopCapture(drag);
    setPreview(null);
    if (commit && drag.preview && drag.preview.layer !== drag.sourceLayer) {
      onReorder(drag.id, drag.preview.layer);
      const item = items.find(({ id }) => id === drag.id);
      setAnnouncement(
        `${item ? (objectNames.get(item.assetId) ?? item.assetId) : 'Объект'}: порядок ${drag.preview.layer} из ${items.length}.`,
      );
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLOListElement>) {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    const handle =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-layer-drag-handle]')
        : null;
    const row = handle?.closest<HTMLElement>('[data-layer-id]');
    const id = row?.dataset.layerId;
    if (!handle || !id) return;
    event.preventDefault();
    const list = event.currentTarget;
    const drag: LayerDrag = {
      id,
      pointerId: event.pointerId,
      sourceLayer: Number(row.dataset.layerOrder),
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      list,
      scrollContainer: findScrollContainer(list),
      frame: null,
      frameTime: null,
      preview: null,
    };
    dragRef.current = drag;
    list.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    onSelect(id);

    function autoScroll(time: number) {
      if (dragRef.current !== drag) return;
      const container = drag.scrollContainer;
      if (container && drag.preview) {
        const isDocument = container === document.scrollingElement;
        const bounds = container.getBoundingClientRect();
        const top = isDocument ? 0 : Math.max(0, bounds.top);
        const bottom = isDocument
          ? window.innerHeight
          : Math.min(window.innerHeight, bounds.bottom);
        const margin = Math.min(48, (bottom - top) / 3);
        let direction = 0;
        if (margin > 0 && drag.y < top + margin)
          direction = -Math.min(1, (top + margin - drag.y) / margin);
        else if (margin > 0 && drag.y > bottom - margin)
          direction = Math.min(1, (drag.y - bottom + margin) / margin);
        if (direction !== 0) {
          const elapsed =
            drag.frameTime === null ? 16 : Math.min(32, time - drag.frameTime);
          const previousScroll = container.scrollTop;
          container.scrollTop += direction * elapsed * 0.8;
          if (container.scrollTop !== previousScroll) updateTarget(drag);
        }
      }
      drag.frameTime = time;
      drag.frame = requestAnimationFrame(autoScroll);
    }
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function handlePointerMove(event: PointerEvent<HTMLOListElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    updateTarget(drag);
  }

  function handlePointerUp(event: PointerEvent<HTMLOListElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    updateTarget(drag);
    endDrag(true);
  }

  function handlePointerCancel(event: PointerEvent<HTMLOListElement>) {
    if (dragRef.current?.pointerId === event.pointerId) endDrag(false);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    id: string,
    layer: number,
  ) {
    if (event.key === 'Escape') {
      if (dragRef.current) {
        event.preventDefault();
        endDrag(false);
      }
      return;
    }
    const direction =
      event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    endDrag(false);
    const target = layer + direction;
    if (target < 1 || target > items.length) return;
    onSelect(id);
    onReorder(id, target);
    const item = items.find((candidate) => candidate.id === id);
    setAnnouncement(
      `${item ? (objectNames.get(item.assetId) ?? item.assetId) : 'Объект'}: порядок ${target} из ${items.length}.`,
    );
  }

  return (
    <div className="layer-list-container">
      <p className="layer-list-hint">Выше в списке — выше на холсте.</p>
      <ol
        className="scene-object-list layer-list"
        aria-label="Порядок слоёв"
        data-drop-at-end={preview?.beforeId === null ? 'true' : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
      >
        {[...items].reverse().map((item, visualIndex) => {
          const layer = items.length - visualIndex;
          const name = objectNames.get(item.assetId) ?? item.assetId;
          return (
            <li
              key={item.id}
              className="layer-list__row"
              data-layer-id={item.id}
              data-layer-order={layer}
              data-dragging={preview?.id === item.id ? 'true' : undefined}
              data-drop-before={
                preview?.beforeId === item.id ? 'true' : undefined
              }
            >
              <button
                type="button"
                className="layer-list__handle"
                data-layer-drag-handle
                aria-label={`Перетащить слой: ${name}, ${layer}`}
                title="Перетащить слой. Стрелки ↑ и ↓ меняют порядок."
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => handleKeyDown(event, item.id, layer)}
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="18"
                  viewBox="0 0 12 18"
                  fill="currentColor"
                >
                  <circle cx="4" cy="4" r="1" />
                  <circle cx="8" cy="4" r="1" />
                  <circle cx="4" cy="9" r="1" />
                  <circle cx="8" cy="9" r="1" />
                  <circle cx="4" cy="14" r="1" />
                  <circle cx="8" cy="14" r="1" />
                </svg>
              </button>
              <button
                type="button"
                className="scene-object"
                aria-pressed={selectedItemId === item.id}
                aria-label={`Выбрать: ${name}, ${layer}`}
                onClick={() => onSelect(item.id)}
              >
                <span className="scene-object__number">{layer}</span>
                <span className="scene-object__name">{name}</span>
                <span
                  className="size-badge"
                  aria-label={`Детализация ${item.size}`}
                >
                  {item.size}
                </span>
                <span className="scene-object__role">
                  {item.role === 'main' ? 'Главный' : 'Фоновый'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="layer-list-status" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
