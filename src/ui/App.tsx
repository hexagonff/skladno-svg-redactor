import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { observer } from 'mobx-react-lite';
import {
  colorSchemes as builtInSchemes,
  loadLibraryManifest,
} from '../services/library';
import { renderAssetSvg, renderScene } from '../services/svg/renderScene';
import { SceneStore } from '../stores/SceneStore';
import { LibraryStore } from '../stores/LibraryStore';
import { SchemeStore } from '../stores/SchemeStore';
import { PaletteDialog } from './PaletteDialog';
import { SvgImportPanel } from './SvgImportPanel';
import { AiComposer } from './AiComposer';
import { CANVAS_IDS, type LibraryManifest } from '../domain/library';
import { clientToScenePoint, type Point } from '../domain/geometry';
import { getSceneItemAtPoint } from '../domain/hitTest';
import { ObjectColorControls } from './ObjectColorControls';
import { ObjectSizeControls } from './ObjectSizeControls';
import { ObjectSelection } from './ObjectSelection';
import { ObjectRotationControls } from './ObjectRotationControls';
import type { RotationDirection } from '../domain/scene';
import { LayerList } from './LayerList';
import { LayerOrderControls } from './LayerOrderControls';
import {
  getObjectGeometry,
  getObjectScaleForDimension,
  startObjectResize,
  resizeObjectFromPointer,
  type ObjectResizeGesture,
  type ResizeCorner,
} from '../domain/objectGeometry';
import './App.css';

interface CanvasGestureBase {
  pointerId: number;
  itemId: string;
  container: HTMLDivElement;
  startClient: Point;
  moved: boolean;
}

type CanvasGesture = CanvasGestureBase &
  (
    | { kind: 'move'; startScene: Point; startPosition: Point }
    | { kind: 'resize'; resize: ObjectResizeGesture }
  );

const Editor = observer(function Editor({
  libraryManifest: initialManifest,
}: {
  libraryManifest: LibraryManifest;
}) {
  const [library] = useState(() => new LibraryStore(initialManifest));
  const [schemes] = useState(() => new SchemeStore(builtInSchemes));
  const colorSchemes = schemes.schemes;
  const [paletteDialogOpen, setPaletteDialogOpen] = useState(false);
  const libraryManifest = library.manifest;
  const catalog = library.catalog;
  const objectNames = useMemo(
    () => new Map(catalog.map(({ id, name }) => [id, name])),
    [catalog],
  );
  const [store] = useState(
    () =>
      new SceneStore(
        undefined,
        () => library.manifest,
        () => schemes.schemes,
      ),
  );
  const gestureRef = useRef<CanvasGesture | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [gestureMode, setGestureMode] = useState<'move' | 'resize' | null>(
    null,
  );
  const { scene, selectedItem } = store;
  const scheme = colorSchemes.find(({ id }) => id === scene.schemeId)!;
  const libraryPreviews = useMemo(() => {
    const previews = new Map<string, string>();
    for (const { id } of catalog) {
      const asset = libraryManifest.assets.find(
        (entry) => entry.id === id && entry.size === 'L',
      );
      if (asset) {
        previews.set(id, renderAssetSvg(asset, scheme, `library-${id}`));
      }
    }
    return previews;
  }, [catalog, libraryManifest, scheme]);
  const sceneSvg = renderScene(scene, libraryManifest, colorSchemes, 'scene');
  const selectedName = selectedItem
    ? objectNames.get(selectedItem.assetId)
    : undefined;
  const selectedGeometry = selectedItem
    ? getObjectGeometry(selectedItem, libraryManifest)
    : undefined;
  const selectedAsset = selectedGeometry?.asset;
  const isObjectHovered =
    hoveredItemId !== null &&
    scene.items.some(({ id }) => id === hoveredItemId);

  function finishGesture(pointerId?: number) {
    const gesture = gestureRef.current;
    if (
      !gesture ||
      (pointerId !== undefined && pointerId !== gesture.pointerId)
    )
      return;
    gestureRef.current = null;
    setGestureMode(null);
    if (gesture.container.hasPointerCapture(gesture.pointerId)) {
      gesture.container.releasePointerCapture(gesture.pointerId);
    }
  }

  function pointOnCanvas(container: HTMLDivElement, client: Point) {
    const svg = container.querySelector<SVGSVGElement>(
      ':scope > .artboard > svg',
    );
    return clientToScenePoint(client, svg?.getScreenCTM() ?? null);
  }

  function startCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || gestureRef.current) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-layer-toolbar]'))
      return;
    // Commit a pending numeric edit before starting a gesture on its new geometry.
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
    const corner = target
      .closest('[data-resize-corner]')
      ?.getAttribute('data-resize-corner');
    const current = store.scene;
    const container = event.currentTarget;
    const startClient = { x: event.clientX, y: event.clientY };
    const startScene = pointOnCanvas(container, startClient);
    if (!startScene) return;
    const item = corner
      ? store.selectedItem
      : getSceneItemAtPoint(current, libraryManifest, startScene);
    if (!corner) store.selectItem(item?.id ?? null);
    setHoveredItemId(item?.id ?? null);
    if (!item) return;
    event.preventDefault();
    // Capture stays on the frame while the artwork and handles are redrawn.
    container.setPointerCapture(event.pointerId);
    const base: CanvasGestureBase = {
      pointerId: event.pointerId,
      itemId: item.id,
      container,
      startClient,
      moved: false,
    };
    gestureRef.current = corner
      ? {
          ...base,
          kind: 'resize',
          resize: startObjectResize(
            item,
            libraryManifest,
            corner as ResizeCorner,
            startScene,
          ),
        }
      : {
          ...base,
          kind: 'move',
          startScene,
          startPosition: { x: item.x, y: item.y },
        };
  }

  function updateCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture) {
      const point = pointOnCanvas(event.currentTarget, {
        x: event.clientX,
        y: event.clientY,
      });
      const hovered = point
        ? getSceneItemAtPoint(store.scene, libraryManifest, point)
        : undefined;
      setHoveredItemId(hovered?.id ?? null);
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    if (!store.scene.items.some(({ id }) => id === gesture.itemId)) {
      finishGesture(event.pointerId);
      return;
    }
    event.preventDefault();
    if (!gesture.moved) {
      const dx = event.clientX - gesture.startClient.x;
      const dy = event.clientY - gesture.startClient.y;
      if (dx * dx + dy * dy < 9) return;
      gesture.moved = true;
      setGestureMode(gesture.kind);
    }
    const point = pointOnCanvas(gesture.container, {
      x: event.clientX,
      y: event.clientY,
    });
    if (!point) {
      finishGesture(event.pointerId);
      return;
    }
    if (gesture.kind === 'resize') {
      const resized = resizeObjectFromPointer(gesture.resize, point);
      store.resizeItem(gesture.itemId, resized.scale, resized.position);
    } else {
      store.moveItem(gesture.itemId, {
        x: gesture.startPosition.x + point.x - gesture.startScene.x,
        y: gesture.startPosition.y + point.y - gesture.startScene.y,
      });
    }
  }

  function endCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    updateCanvasGesture(event);
    finishGesture(event.pointerId);
  }

  function changeSelectedRotation(direction: RotationDirection) {
    finishGesture();
    store.rotateSelected(direction);
  }

  function changeSelectedScale(scale: number) {
    finishGesture();
    store.setSelectedScale(scale);
  }

  useEffect(
    () => () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (gesture?.container.hasPointerCapture(gesture.pointerId)) {
        gesture.container.releasePointerCapture(gesture.pointerId);
      }
    },
    [],
  );

  function downloadSvg() {
    const url = URL.createObjectURL(
      new Blob([sceneSvg], { type: 'image/svg+xml;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'skladno.svg';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="./" aria-label="Складно — SVG-конструктор">
          <span className="brand__mark" aria-hidden="true">
            с
          </span>
          <span className="brand__name">Складно</span>
          <span className="brand__description">SVG-конструктор</span>
        </a>
        <button className="button button--primary" onClick={downloadSvg}>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="button__icon">
            <path d="M10 3v9m-3-3 3 3 3-3M4 13v4h12v-4" />
          </svg>
          Скачать SVG
        </button>
      </header>

      <main className="workspace" aria-label="Редактор композиции">
        <aside
          className="workspace__panel library-panel"
          aria-labelledby="library-title"
        >
          <AiComposer
            catalog={catalog}
            onApply={(plan) => {
              finishGesture();
              store.applyComposition(plan);
              setHoveredItemId(null);
            }}
          />
          <SvgImportPanel
            scheme={scheme}
            onImport={(name, inspected, colors) => {
              finishGesture();
              library.importObject(name, inspected, colors, scheme.id);
            }}
          />
          <div className="panel-heading library-heading">
            <h1 id="library-title">Библиотека</h1>
            <span className="count-badge">{catalog.length}</span>
          </div>
          <p className="panel-description">
            Нажмите на объект, чтобы добавить его на холст.
          </p>
          <div className="library-grid">
            {catalog.map(({ id, name }) => {
              const preview = libraryPreviews.get(id);
              if (!preview) return null;
              return (
                <button
                  className="library-item"
                  key={id}
                  aria-label={`Добавить: ${name}`}
                  onClick={() => {
                    finishGesture();
                    store.addItem(id);
                  }}
                >
                  <span
                    className="library-item__preview"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: preview,
                    }}
                  />
                  <span className="library-item__name">{name}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="workspace__canvas" aria-labelledby="canvas-title">
          <div className="canvas-toolbar">
            <h2 id="canvas-title">Холст</h2>
            <span className="canvas-toolbar__meta">1000 × 1000</span>
          </div>
          <div className="canvas-stage">
            <div
              className={`artboard-frame${gestureMode === 'resize' ? ' artboard-frame--resizing' : ''}`}
              onPointerDown={startCanvasGesture}
              onPointerMove={updateCanvasGesture}
              onPointerLeave={() => setHoveredItemId(null)}
              onPointerUp={endCanvasGesture}
              onPointerCancel={(event) => finishGesture(event.pointerId)}
              onLostPointerCapture={(event) => finishGesture(event.pointerId)}
            >
              <div
                className={`artboard${isObjectHovered ? ' artboard--object-hovered' : ''}${gestureMode === 'move' ? ' artboard--dragging' : ''}`}
                role="group"
                aria-label="Холст композиции"
                dangerouslySetInnerHTML={{ __html: sceneSvg }}
              />
              {selectedItem && selectedGeometry && (
                <div className="selection-layer">
                  <ObjectSelection
                    item={selectedItem}
                    width={selectedGeometry.width}
                    height={selectedGeometry.height}
                    sceneWidth={scene.width}
                    sceneHeight={scene.height}
                    onScaleChange={changeSelectedScale}
                    onRotate={changeSelectedRotation}
                    layer={store.selectedLayer!}
                    canRaise={store.canRaiseSelected}
                    canLower={store.canLowerSelected}
                    onLayerChange={(direction) => {
                      finishGesture();
                      store.moveSelectedLayer(direction);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <p className="canvas-status" aria-live="polite">
            <span className="canvas-status__dot" aria-hidden="true" />
            {selectedName
              ? `Выбран объект: ${selectedName}`
              : scene.items.length === 0
                ? 'Добавьте первый объект из библиотеки'
                : `Объектов на холсте: ${scene.items.length}`}
          </p>
        </section>

        <aside
          className="workspace__panel settings-panel"
          aria-labelledby="settings-title"
        >
          <div className="panel-heading">
            <h2 id="settings-title">Настройки</h2>
          </div>
          <section
            className="settings-section"
            aria-labelledby="background-title"
          >
            <label
              id="background-title"
              className="field-label"
              htmlFor="background-select"
            >
              Фон
            </label>
            <select
              id="background-select"
              value={scene.canvasId}
              onChange={(event) => {
                const next = CANVAS_IDS.find((id) => id === event.target.value);
                if (next) {
                  finishGesture();
                  store.setCanvas(next);
                }
              }}
            >
              {CANVAS_IDS.map((id, index) => (
                <option key={id} value={id}>
                  Фон {index + 1}
                </option>
              ))}
            </select>
          </section>

          <section className="settings-section" aria-labelledby="scheme-title">
            <label
              id="scheme-title"
              className="field-label"
              htmlFor="scheme-select"
            >
              Палитра
            </label>
            <select
              id="scheme-select"
              value={scene.schemeId}
              onChange={(event) => {
                const next = colorSchemes.find(
                  ({ id }) => id === event.target.value,
                );
                if (next) store.setScheme(next.id);
              }}
            >
              {colorSchemes.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <div className="scheme-swatches" aria-hidden="true">
              {(['bg1', 'bg2', 'bg3', 'obj1', 'obj2', 'obj3'] as const).map(
                (role) => (
                  <span
                    key={role}
                    style={{ backgroundColor: scheme.colors[role] }}
                  />
                ),
              )}
            </div>
            <button
              className="button scheme-add-button"
              type="button"
              onClick={() => {
                finishGesture();
                setPaletteDialogOpen(true);
              }}
            >
              Добавить палитру
            </button>
          </section>

          <section
            className="settings-section selection-settings"
            aria-labelledby="selection-title"
          >
            <h3 id="selection-title">Выбранный объект</h3>
            {selectedItem ? (
              <>
                <p className="selected-object-name">{selectedName}</p>
                <p className="field-hint">
                  Перетащите объект на холсте, чтобы изменить его положение.
                </p>
                <LayerOrderControls
                  key={`layer-${selectedItem.id}`}
                  layer={store.selectedLayer!}
                  total={scene.items.length}
                  onChange={(layer) => {
                    finishGesture();
                    store.setSelectedLayer(layer);
                  }}
                />
                <div className="object-size">
                  <h4 className="object-size__title">Детализация</h4>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Детализация объекта"
                  >
                    {(['L', 'S'] as const).map((size) => (
                      <button
                        key={size}
                        aria-pressed={selectedItem.size === size}
                        disabled={
                          !libraryManifest.assets.some(
                            (asset) =>
                              asset.id === selectedItem.assetId &&
                              asset.size === size &&
                              asset.kind === 'object',
                          )
                        }
                        onClick={() => {
                          finishGesture();
                          store.setSelectedSize(size);
                        }}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                  {!libraryManifest.assets.some(
                    (asset) =>
                      asset.id === selectedItem.assetId && asset.size === 'S',
                  ) && (
                    <p className="field-hint">
                      Загружен один SVG: вариант S отсутствует.
                    </p>
                  )}
                </div>
                {selectedGeometry && (
                  <ObjectSizeControls
                    key={selectedItem.id}
                    width={selectedGeometry.width}
                    height={selectedGeometry.height}
                    onChange={(dimension, value) => {
                      const scale = getObjectScaleForDimension(
                        selectedItem,
                        libraryManifest,
                        dimension,
                        value,
                      );
                      changeSelectedScale(scale);
                    }}
                  />
                )}
                <ObjectRotationControls
                  rotation={selectedItem.rotation}
                  onRotate={changeSelectedRotation}
                />
                <div
                  className="segmented-control"
                  role="group"
                  aria-label="Роль объекта"
                >
                  <button
                    aria-pressed={selectedItem.role === 'main'}
                    onClick={() => store.setSelectedRole('main')}
                  >
                    Главный
                  </button>
                  <button
                    aria-pressed={selectedItem.role === 'bg'}
                    onClick={() => store.setSelectedRole('bg')}
                  >
                    Фоновый
                  </button>
                </div>
                {selectedAsset && (
                  <ObjectColorControls
                    key={`${selectedItem.id}-${selectedItem.role}`}
                    asset={selectedAsset}
                    item={selectedItem}
                    scheme={scheme}
                    onChange={store.setSelectedColor}
                    onReset={store.resetSelectedColors}
                  />
                )}
              </>
            ) : (
              <p className="field-hint">
                Выберите объект на холсте или в списке ниже.
              </p>
            )}
            <button
              className="button button--delete"
              disabled={!selectedItem}
              onClick={() => {
                finishGesture();
                store.deleteSelectedItem();
              }}
            >
              Удалить выбранный
            </button>
          </section>

          <section
            className="settings-section scene-objects"
            aria-labelledby="objects-title"
          >
            <div className="section-heading">
              <h3 id="objects-title">Слои</h3>
              <span className="count-badge">{scene.items.length}</span>
            </div>
            {scene.items.length === 0 ? (
              <p className="field-hint">Пока только подложка.</p>
            ) : (
              <>
                <p className="field-hint">
                  Перетаскивайте слои за значок слева.
                </p>
                <LayerList
                  items={scene.items}
                  selectedItemId={store.selectedItemId}
                  objectNames={objectNames}
                  onSelect={(id) => {
                    finishGesture();
                    store.selectItem(id);
                  }}
                  onReorder={(id, layer) => {
                    finishGesture();
                    store.setItemLayer(id, layer);
                  }}
                />
              </>
            )}
          </section>
        </aside>
      </main>
      {paletteDialogOpen && (
        <PaletteDialog
          baseScheme={scheme}
          onClose={() => setPaletteDialogOpen(false)}
          onAdd={(name, colors) => {
            finishGesture();
            const id = schemes.addScheme(name, colors);
            store.setScheme(id);
          }}
        />
      )}
    </div>
  );
});

type LibraryState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: LibraryManifest }
  | { status: 'error' };

export default function App() {
  const [libraryState, setLibraryState] = useState<LibraryState>({
    status: 'loading',
  });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadLibraryManifest(controller.signal)
      .then((manifest) => {
        if (!controller.signal.aborted) {
          setLibraryState({ status: 'ready', manifest });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLibraryState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [loadAttempt]);

  if (libraryState.status === 'ready') {
    return <Editor libraryManifest={libraryState.manifest} />;
  }

  return (
    <main className="library-state" aria-label="Складно">
      <div className="library-state__content">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            с
          </span>
          <span className="brand__name">Складно</span>
        </div>
        {libraryState.status === 'error' ? (
          <>
            <p role="alert">Не удалось загрузить библиотеку.</p>
            <button
              className="button button--primary"
              onClick={() => {
                setLibraryState({ status: 'loading' });
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Повторить загрузку
            </button>
          </>
        ) : (
          <p role="status">Загружаем библиотеку…</p>
        )}
      </div>
    </main>
  );
}
