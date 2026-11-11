import type { ObjectId } from './scene';

export interface CatalogObject {
  id: ObjectId;
  name: string;
}

export const OBJECT_CATALOG: readonly CatalogObject[] = [
  { id: 'book', name: 'Книга' },
  { id: 'phone', name: 'Телефон' },
  { id: 'puzzle', name: 'Пазлы' },
  { id: 'coin', name: 'Монета' },
  { id: 'headphones', name: 'Наушники' },
  { id: 'lamp', name: 'Лампа' },
  { id: 'vase', name: 'Ваза с цветами' },
  { id: 'wallet', name: 'Кошелёк' },
  { id: 'folder', name: 'Папка' },
  { id: 'pen', name: 'Ручка' },
];
