import { describe, expect, it } from 'vitest';
import { isImportedAssetId } from './library';

describe('session asset identifiers', () => {
  it.each(['custom-1', 'custom-20', 'custom-abc-123'])('accepts %s', (id) => {
    expect(isImportedAssetId(id)).toBe(true);
  });

  it.each([
    'book',
    'canvas1',
    'custom-',
    'custom--1',
    'custom-1-',
    'custom-hello world',
    'custom-../asset',
    'custom-<script>',
    'custom-' + 'a'.repeat(122),
    undefined,
    null,
    1,
  ])('rejects invalid session identifier %j', (id) => {
    expect(isImportedAssetId(id)).toBe(false);
  });
});
