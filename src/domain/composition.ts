import { z } from 'zod';
import { OBJECT_CATALOG, type CatalogObject } from './catalog';
import { isImportedAssetId } from './library';
import type { ObjectId, SceneRole } from './scene';

export const COMPOSITION_PROMPT_MAX_LENGTH = 1000;
export const COMPOSITION_MAX_ITEMS = 6;
export const COMPOSITION_MAX_BACKGROUND_ITEMS = 2;

export interface CompositionCatalogEntry {
  id: ObjectId;
  name: string;
  description: string;
}

export interface CompositionRequest {
  prompt: string;
  catalog: CompositionCatalogEntry[];
}

export interface CompositionPlan {
  items: { assetId: ObjectId; role: SceneRole }[];
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
const objectIdSchema = z.custom<ObjectId>(
  (value) =>
    typeof value === 'string' &&
    (builtinIds.includes(value) || isImportedAssetId(value)),
);
const catalogEntrySchema = z.strictObject({
  id: objectIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
});
const requestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(COMPOSITION_PROMPT_MAX_LENGTH),
  catalog: z.array(catalogEntrySchema).min(1).max(100),
});
const planSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({ assetId: objectIdSchema, role: z.enum(['main', 'bg']) }),
    )
    .max(COMPOSITION_MAX_ITEMS),
  message: z.string().trim().min(1).max(600),
});

/** Built-in descriptions are canonical; uploaded assets are described only by their registered name. */
export function createCompositionCatalog(
  catalog: readonly CatalogObject[],
): CompositionCatalogEntry[] {
  return catalog.map(({ id, name }) => {
    const builtin = OBJECT_CATALOG.find((entry) => entry.id === id);
    return {
      id,
      name: builtin?.name ?? name,
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
  return parsed.data;
}

/** Validates semantics in addition to the model's JSON shape. No geometry or paint values are accepted. */
export function validateCompositionPlan(
  value: unknown,
  catalog: readonly Pick<CompositionCatalogEntry, 'id'>[],
): CompositionPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      'Модель вернула некорректный план композиции. Попробуйте ещё раз.',
    );
  const plan = parsed.data;
  const knownIds = new Set(catalog.map(({ id }) => id));
  if (
    plan.items.some(({ assetId }) => !knownIds.has(assetId)) ||
    new Set(plan.items.map(({ assetId }) => assetId)).size !==
      plan.items.length ||
    plan.items.filter(({ role }) => role === 'bg').length >
      COMPOSITION_MAX_BACKGROUND_ITEMS ||
    (plan.items.length > 0 && !plan.items.some(({ role }) => role === 'main'))
  ) {
    throw new Error(
      'Модель выбрала недоступные или несовместимые объекты. Попробуйте ещё раз.',
    );
  }
  return plan;
}
