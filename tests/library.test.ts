import { expect, it } from 'vitest';
import { filterLocal, localName, type LocalItem } from '../apps/web/src/library-model';
const fixture: LocalItem[] = [
  {
    id: 'car:a',
    kind: 'car',
    parent: null,
    path: 'content/cars/a',
    metadata: {
      name: 'Alpha',
      brand: 'BMW',
      country: 'Germany',
      author: 'Real author',
      tags: ['street'],
    },
    bytes: 300,
    files: 3,
    image: null,
    source: 'external',
    warnings: [],
  },
  {
    id: 'skin:b',
    kind: 'skin',
    parent: 'car:a',
    path: 'content/cars/a/skins/b',
    metadata: { skinname: 'Blue' },
    bytes: 100,
    files: 1,
    image: null,
    source: 'launcher',
    warnings: [],
  },
  {
    id: 'track:c',
    kind: 'track',
    parent: null,
    path: 'content/tracks/c',
    metadata: {},
    bytes: 900,
    files: 9,
    image: null,
    source: 'mixed',
    warnings: ['Missing UI'],
  },
];
it('searches actual author, brand, country and tags without inventing metadata', () => {
  for (const query of ['BMW', 'Germany', 'real author', 'street'])
    expect(filterLocal(fixture, query, 'all', 'all', 'name').map((i) => i.id)).toEqual(['car:a']);
  expect(localName(fixture[2])).toBe('نامشخص');
  expect(localName(fixture[1])).toBe('Blue');
});
it('combines type/origin filters and sorts by real directory bytes without mutating input', () => {
  expect(filterLocal(fixture, '', 'car', 'external', 'size')).toEqual([fixture[0]]);
  expect(filterLocal(fixture, '', 'skin', 'external', 'size')).toEqual([]);
  expect(filterLocal(fixture, '', 'all', 'all', 'size').map((i) => i.bytes)).toEqual([
    900, 300, 100,
  ]);
  expect(fixture[0].id).toBe('car:a');
});
