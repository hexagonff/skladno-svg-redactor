import { z } from 'zod';
import builtinSourceSizes from '../assets/source-sizes.json';
import { OBJECT_CATALOG, type CatalogObject } from './catalog';
import {
  ASSET_SIZES,
  isImportedAssetId,
  type AssetSize,
  type LibraryManifest,
} from './library';
import type { ObjectId, SceneRole } from './scene';

export const COMPOSITION_PROMPT_MAX_LENGTH = 1000;
export const COMPOSITION_MAX_ITEMS = 6;

export interface SourceDimensions {
  width: number;
  height: number;
}

export interface CompositionCatalogEntry {
  id: ObjectId;
  name: string;
  description: string;
  availableSizes?: AssetSize[];
  sourceSizes?: Partial<Record<AssetSize, SourceDimensions>>;
}

export interface CompositionRequest {
  prompt: string;
  catalog: CompositionCatalogEntry[];
  canvas?: SourceDimensions;
}

export interface CompositionPlan {
  items: { assetId: ObjectId; role: SceneRole; size?: AssetSize }[];
  message: string;
}

const builtinDescriptions: Readonly<Record<string, string>> = {
  book: 'Раскрытая книга. Чтение, учёба, знания, подготовка к экзамену.',
  phone: 'Смартфон. Общение, связь, приложения, технологии, работа онлайн.',
  puzzle:
    'Детали пазла. Решение задач, команда, идеи, поиск связи и сборка целого.',
  coin: 'Монета. Деньги, сбережения, оплата, финансы.',
  headphones: 'Наушники. Музыка, подкасты, аудио, сосредоточенная работа.',
  lamp: 'Настольная лампа. Рабочее место, вечерняя учёба, свет, идея.',
  vase: 'Ваза с цветами. Уют, дом, украшение, подарок, отдых.',
  wallet: 'Кошелёк. Личные финансы, покупки, деньги, расходы.',
  folder: 'Папка для документов. Работа, организация, документы, учёба.',
  pen: 'Ручка. Записи, письмо, учёба, заметки, планирование.',
};
const builtinIds: readonly string[] = OBJECT_CATALOG.map(({ id }) => id);
function defaultAvailableSizes(id: string): AssetSize[] {
  return builtinIds.includes(id) ? [...ASSET_SIZES] : ['L'];
}

const dimensionsSchema = z.strictObject({
  width: z.number().positive().max(1e6),
  height: z.number().positive().max(1e6),
});
const sizeSchema = z.enum(ASSET_SIZES);
const objectIdSchema = z.custom<ObjectId>(
  (value) =>
    typeof value === 'string' &&
    (builtinIds.includes(value) || isImportedAssetId(value)),
);
const catalogEntrySchema = z.strictObject({
  id: objectIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  sourceSizes: z
    .strictObject({
      L: dimensionsSchema.optional(),
      S: dimensionsSchema.optional(),
    })
    .optional(),
  availableSizes: z
    .array(sizeSchema)
    .min(1)
    .max(ASSET_SIZES.length)
    .refine((sizes) => new Set(sizes).size === sizes.length)
    .optional(),
});
const requestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(COMPOSITION_PROMPT_MAX_LENGTH),
  catalog: z.array(catalogEntrySchema).min(1).max(100),
  canvas: dimensionsSchema.optional(),
});
const planSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        assetId: objectIdSchema,
        role: z.enum(['main', 'bg']),
        size: sizeSchema.default('L'),
      }),
    )
    .max(COMPOSITION_MAX_ITEMS),
  message: z.string().trim().min(1).max(600),
});

/** Built-in descriptions are canonical; uploaded assets are described only by their registered name. */
export function createCompositionCatalog(
  catalog: readonly (CatalogObject & {
    sourceSizes?: Partial<Record<AssetSize, SourceDimensions>>;
  })[],
  manifest?: LibraryManifest,
): CompositionCatalogEntry[] {
  return catalog.map(({ id, name, sourceSizes }) => {
    const builtin = OBJECT_CATALOG.find((entry) => entry.id === id);
    const availableSizes = manifest
      ? ASSET_SIZES.filter((size) =>
          manifest.assets.some(
            (asset) =>
              asset.kind === 'object' && asset.id === id && asset.size === size,
          ),
        )
      : defaultAvailableSizes(id);
    const dimensions: Partial<Record<AssetSize, SourceDimensions>> = {};
    for (const size of availableSizes) {
      const source = manifest
        ? manifest.assets.find(
            (asset) =>
              asset.kind === 'object' && asset.id === id && asset.size === size,
          )
        : builtin
          ? (
              builtinSourceSizes as Record<
                string,
                Partial<Record<AssetSize, SourceDimensions>>
              >
            )[id]?.[size]
          : sourceSizes?.[size];
      if (
        source &&
        [source.width, source.height].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      ) {
        dimensions[size] = { width: source.width, height: source.height };
      }
    }
    return {
      id,
      name: builtin?.name ?? name,
      availableSizes,
      ...(Object.keys(dimensions).length ? { sourceSizes: dimensions } : {}),
      description:
        builtinDescriptions[id] ??
        `Загруженный пользователем объект «${name}». Используй, только если название подходит к запросу.`,
    };
  });
}

export function validateCompositionRequest(value: unknown): CompositionRequest {
  const parsed = requestSchema.safeParse(value);
  if (
    !parsed.success ||
    new Set(parsed.data.catalog.map(({ id }) => id)).size !==
      parsed.data.catalog.length
  ) {
    throw new Error(
      'Введите запрос до 1000 символов и передайте корректный каталог без повторов.',
    );
  }
  return {
    ...parsed.data,
    catalog: parsed.data.catalog.map((entry) => ({
      ...entry,
      availableSizes: entry.availableSizes
        ? ASSET_SIZES.filter((size) => entry.availableSizes!.includes(size))
        : defaultAvailableSizes(entry.id),
    })),
  };
}

/** Validates semantics in addition to the model's JSON shape. No geometry or paint values are accepted. */
export function validateCompositionPlan(
  value: unknown,
  catalog: readonly {
    id: string;
    availableSizes?: readonly AssetSize[];
  }[],
): CompositionPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      'Модель вернула некорректный план композиции. Попробуйте ещё раз.',
    );
  const plan = parsed.data;
  const availableSizes = new Map(
    catalog.map((entry) => [
      entry.id,
      entry.availableSizes ?? defaultAvailableSizes(entry.id),
    ]),
  );
  if (
    plan.items.some(
      ({ assetId, size }) => !availableSizes.get(assetId)?.includes(size),
    ) ||
    new Set(plan.items.map(({ assetId }) => assetId)).size !== plan.items.length
  ) {
    throw new Error(
      'Модель выбрала недоступные или несовместимые объекты. Попробуйте ещё раз.',
    );
  }
  return plan;
}
