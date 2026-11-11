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

/** Place sources without resizing; oversized sources may extend beyond the canvas. */
function placeOverlapping(
  items: SizedItem[],
  scene: Scene,
  margin: number,
  seed: number,
): void {
  const ordered = [...items].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  const anchors = [0, 0.25, 0.5, 0.75, 1];
  type Placement = { entry: SizedItem; x: number; y: number };
  const axisPositions = (length: number, extent: number) => {
    const fits = length <= extent - margin * 2;
    // Keep smaller sources whole. Let larger ones move to an edge and leave
    // room for accents, keeping the source centre inside the frame.
    const visible = Math.min(length, extent) * 0.65;
    const from = fits ? margin + length / 2 : Math.max(0, visible - length / 2);
    const to = fits
      ? extent - margin - length / 2
      : Math.min(extent, extent - visible + length / 2);
    return anchors.map((fraction) => from + (to - from) * fraction);
  };
  const positions = (entry: SizedItem) =>
    axisPositions(entry.height, scene.height).flatMap((y) =>
      axisPositions(entry.width, scene.width).map((x) => ({ entry, x, y })),
    );
  const visibleBounds = ({ entry, x, y }: Placement) => ({
    left: Math.max(0, x - entry.width / 2),
    right: Math.min(scene.width, x + entry.width / 2),
    top: Math.max(0, y - entry.height / 2),
    bottom: Math.min(scene.height, y + entry.height / 2),
  });
  const visibleArea = (placement: Placement) => {
    const box = visibleBounds(placement);
    return (box.right - box.left) * (box.bottom - box.top);
  };
  const cropCost = (placement: Placement) =>
    (1 -
      visibleArea(placement) /
        (Math.min(placement.entry.width, scene.width) *
          Math.min(placement.entry.height, scene.height))) *
    1.5;
  const positionCost = (placement: Placement) =>
    cropCost(placement) +
    (((placement.x - scene.width / 2) / scene.width) ** 2 +
      ((placement.y - scene.height / 2) / scene.height) ** 2) *
      0.02;
  const overlapCost = (next: Placement, previous: Placement[]) => {
    const box = visibleBounds(next);
    return previous.reduce((cost, other) => {
      const otherBox = visibleBounds(other);
      const width = Math.max(
        0,
        Math.min(box.right, otherBox.right) - Math.max(box.left, otherBox.left),
      );
      const height = Math.max(
        0,
        Math.min(box.bottom, otherBox.bottom) - Math.max(box.top, otherBox.top),
      );
      const fraction =
        (width * height) / Math.min(visibleArea(next), visibleArea(other));
      const weight =
        next.entry.item.role === 'main' && other.entry.item.role === 'main'
          ? 3
          : 1;
      return cost + weight * (fraction + fraction ** 3 * 8);
    }, 0);
  };
  const solutions = positions(ordered[0]).map((first) => {
    const placed = [first];
    let score = positionCost(first);
    for (const entry of ordered.slice(1)) {
      const choices = positions(entry).map((position, index, options) => ({
        position,
        cost: overlapCost(position, placed) + positionCost(position),
        tie: (index + seed) % options.length,
      }));
      choices.sort((a, b) => a.cost - b.cost || a.tie - b.tie);
      score += choices[0].cost;
      placed.push(choices[0].position);
    }
    const boxes = placed.map(visibleBounds);
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.right));
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    score +=
      Math.abs((left + right) / scene.width - 1) * 0.1 +
      Math.abs((top + bottom) / scene.height - 1) * 0.1;
    return { placed, score };
  });
  solutions.sort((a, b) => a.score - b.score);
  for (const { entry, x, y } of solutions[0].placed) {
    entry.item.x = seed % 2 ? scene.width - x : x;
    entry.item.y = Math.floor(seed / 2) % 2 ? scene.height - y : y;
  }
}

/** Preserve the exact source sizes selected by AI, including sources larger than the canvas. */
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
    placeOverlapping(items, scene, margin, seed);
  } else {
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
  }
  // Keep role-based layers; within each role smaller sources stay above larger ones.
  const placed = [...items]
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .map(({ item }) => item);
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
