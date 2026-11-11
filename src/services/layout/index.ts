import {
  validateCompositionPlan,
  type CompositionPlan,
} from '../../domain/composition';
import type { LibraryManifest } from '../../domain/library';
import { getDefaultObjectScale } from '../../domain/objectDefaults';
import { getObjectGeometry } from '../../domain/objectGeometry';
import {
  assertScene,
  createSceneItem,
  type Scene,
  type SceneItem,
} from '../../domain/scene';

interface SizedItem {
  item: SceneItem;
  width: number;
  height: number;
}

interface LayoutCandidate {
  groups: number[][];
  horizontal: boolean;
  width: number;
  height: number;
  score: number;
}

function* permutations(values: number[]): Generator<number[]> {
  if (values.length <= 1) {
    yield values;
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    for (const rest of permutations(
      values.filter((_, other) => other !== index),
    )) {
      yield [values[index], ...rest];
    }
  }
}

function splitGroups(order: number[], mask: number): number[][] {
  const groups: number[][] = [[]];
  order.forEach((index, position) => {
    groups[groups.length - 1].push(index);
    if ((mask & (1 << position)) !== 0 && position < order.length - 1) {
      groups.push([]);
    }
  });
  return groups;
}

function groupDimensions(
  group: number[],
  items: SizedItem[],
  horizontal: boolean,
  gap: number,
): { along: number; across: number } {
  return {
    along: group.reduce(
      (sum, index) =>
        sum + (horizontal ? items[index].width : items[index].height),
      gap * (group.length - 1),
    ),
    across: Math.max(
      ...group.map((index) =>
        horizontal ? items[index].height : items[index].width,
      ),
    ),
  };
}

/** Enumerate rows and columns; no candidate changes an object's scale or paths. */
function chooseLayout(
  items: SizedItem[],
  innerWidth: number,
  innerHeight: number,
  gap: number,
  seed: number,
): LayoutCandidate | undefined {
  const candidates: LayoutCandidate[] = [];
  const normalizedArea = items.reduce(
    (sum, item) =>
      sum + (item.width / innerWidth) * (item.height / innerHeight),
    0,
  );
  if (!Number.isFinite(normalizedArea) || normalizedArea > 1) return undefined;

  for (const order of permutations(items.map((_, index) => index))) {
    for (let mask = 0; mask < 2 ** (items.length - 1); mask += 1) {
      const groups = splitGroups(order, mask);
      for (const horizontal of [true, false]) {
        const dimensions = groups.map((group) =>
          groupDimensions(group, items, horizontal, gap),
        );
        const along = Math.max(...dimensions.map((group) => group.along));
        const across = dimensions.reduce(
          (sum, group) => sum + group.across,
          gap * (groups.length - 1),
        );
        const width = horizontal ? along : across;
        const height = horizontal ? across : along;
        if (width > innerWidth || height > innerHeight) continue;
        const normalizedWidth = width / innerWidth;
        const normalizedHeight = height / innerHeight;
        const score =
          Math.abs(Math.log(normalizedWidth / normalizedHeight)) * 2 +
          ((normalizedWidth * normalizedHeight) / normalizedArea - 1) * 0.25;
        if (!Number.isFinite(score)) continue;
        const candidate = { groups, horizontal, width, height, score };
        const insertion = candidates.findIndex(
          (current) => current.score > score,
        );
        if (insertion === -1) {
          if (candidates.length < 24) candidates.push(candidate);
        } else {
          candidates.splice(insertion, 0, candidate);
          if (candidates.length > 24) candidates.pop();
        }
      }
    }
  }
  if (candidates.length === 0) return undefined;
  // Restrict variants to similarly balanced candidates, rather than taking a poor fit.
  const bestScore = candidates[0].score;
  const variants = candidates.filter(
    (candidate) => candidate.score <= bestScore + 0.2,
  );
  return variants[seed % variants.length];
}

/** Replace a composition only after every catalog object fits at its established size. */
export function composeScene(
  scene: Scene,
  manifest: LibraryManifest,
  plan: CompositionPlan,
  seed = 0,
): Scene {
  assertScene(scene);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error('Номер варианта должен быть целым неотрицательным числом.');
  }
  const catalog = manifest.assets
    .filter((asset) => asset.kind === 'object' && asset.size === 'L')
    .map((asset) => ({
      id: asset.id,
      availableSizes: manifest.assets
        .filter(
          (variant) => variant.kind === 'object' && variant.id === asset.id,
        )
        .map((variant) => variant.size),
    }));
  const validated = validateCompositionPlan(plan, catalog);
  if (validated.items.length === 0) {
    throw new Error(
      validated.message || 'Не найдены подходящие объекты для композиции.',
    );
  }
  const usedIds = new Set(scene.items.map((item) => item.id));
  let nextId = 1;
  const items: SizedItem[] = validated.items.map(({ assetId, role, size }) => {
    while (usedIds.has(`composition-${nextId}`)) nextId += 1;
    const id = `composition-${nextId++}`;
    usedIds.add(id);
    const item = {
      ...createSceneItem(assetId, id),
      size: size ?? 'L',
      role,
      scale: getDefaultObjectScale(assetId, manifest),
    };
    const geometry = getObjectGeometry(item, manifest);
    return { item, width: geometry.width, height: geometry.height };
  });
  const smallerSide = Math.min(scene.width, scene.height);
  const margin = smallerSide * 0.04;
  const gap = smallerSide * 0.024;
  const innerWidth = scene.width - margin * 2;
  const innerHeight = scene.height - margin * 2;
  const candidate = chooseLayout(items, innerWidth, innerHeight, gap, seed);
  if (!candidate) {
    throw new Error(
      'Не удалось разместить все объекты в исходных размерах. Выберите более просторный формат или меньше объектов.',
    );
  }

  const { groups, horizontal, width, height } = candidate;
  const left = (scene.width - width) / 2;
  const top = (scene.height - height) / 2;
  let acrossOffset = 0;
  for (const group of groups) {
    const dimensions = groupDimensions(group, items, horizontal, gap);
    const availableAlong = horizontal ? width : height;
    let alongOffset = (availableAlong - dimensions.along) / 2;
    for (const index of group) {
      const entry = items[index];
      const along = horizontal ? entry.width : entry.height;
      entry.item.x =
        left +
        (horizontal
          ? alongOffset + along / 2
          : acrossOffset + dimensions.across / 2);
      entry.item.y =
        top +
        (horizontal
          ? acrossOffset + dimensions.across / 2
          : alongOffset + along / 2);
      alongOffset += along + gap;
    }
    acrossOffset += dimensions.across + gap;
  }
  const placed = items.map(({ item }) => item);
  const composed = {
    ...scene,
    items: [
      ...placed.filter((item) => item.role === 'bg'),
      ...placed.filter((item) => item.role === 'main'),
    ],
  };
  assertScene(composed);
  return composed;
}
