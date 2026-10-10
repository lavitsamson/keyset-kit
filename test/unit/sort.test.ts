import { describe, expect, it } from 'vitest';
import { resolveSort, reverseSort, sortHash } from '../../src/core/sort.js';
import type { SortField } from '../../src/index.js';

type Row = Record<string, unknown>;
const spec = (...fields: SortField<Row>[]): SortField<Row>[] => fields;

describe('resolveSort', () => {
  it('defaults nulls to PostgreSQL behaviour (last ascending, first descending)', () => {
    expect(
      resolveSort(spec({ field: 'a', direction: 'asc' }, { field: 'id', direction: 'desc' })),
    ).toEqual([
      { field: 'a', direction: 'asc', nulls: 'last' },
      { field: 'id', direction: 'desc', nulls: 'first' },
    ]);
  });

  it('keeps an explicit nulls option', () => {
    expect(resolveSort(spec({ field: 'a', direction: 'asc', nulls: 'first' }))).toEqual([
      { field: 'a', direction: 'asc', nulls: 'first' },
    ]);
  });

  it.each([
    ['an empty array', []],
    ['a non-array', 'id'],
    ['undefined', undefined],
  ])('rejects %s', (_, sort) => {
    expect(() => resolveSort(sort as unknown as SortField<Row>[])).toThrow(/non-empty array/);
  });

  it('rejects an empty or non-string field', () => {
    expect(() => resolveSort(spec({ field: '', direction: 'asc' }))).toThrow(
      /sort\[0\]\.field must be a non-empty string/,
    );
    expect(() =>
      resolveSort([{ field: 1, direction: 'asc' }] as unknown as SortField<Row>[]),
    ).toThrow(/sort\[0\]\.field/);
  });

  it('rejects a field listed twice', () => {
    expect(() =>
      resolveSort(spec({ field: 'id', direction: 'asc' }, { field: 'id', direction: 'desc' })),
    ).toThrow(/"id" appears more than once/);
  });

  it('rejects an invalid direction or nulls value with the offending value in the message', () => {
    expect(() =>
      resolveSort([{ field: 'id', direction: 'up' }] as unknown as SortField<Row>[]),
    ).toThrow(/direction "up"; use 'asc' or 'desc'/);
    expect(() =>
      resolveSort([{ field: 'id', direction: 'asc', nulls: 'top' }] as unknown as SortField<Row>[]),
    ).toThrow(/nulls "top"; use 'first', 'last' or omit it/);
  });
});

describe('reverseSort', () => {
  it('flips direction and null placement so the order is exactly reversed', () => {
    expect(
      reverseSort([
        { field: 'a', direction: 'asc', nulls: 'last' },
        { field: 'id', direction: 'desc', nulls: 'first' },
      ]),
    ).toEqual([
      { field: 'a', direction: 'desc', nulls: 'first' },
      { field: 'id', direction: 'asc', nulls: 'last' },
    ]);
  });
});

describe('sortHash', () => {
  const hash = (...fields: SortField<Row>[]): string => sortHash(resolveSort(fields));

  it('is stable and short', () => {
    const h = hash({ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' });
    expect(h).toBe(
      hash({ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }),
    );
    expect(h).toMatch(/^[0-9a-z]{1,7}$/);
  });

  it('treats an explicit default nulls option as the same spec', () => {
    expect(hash({ field: 'a', direction: 'asc', nulls: 'last' })).toBe(
      hash({ field: 'a', direction: 'asc' }),
    );
  });

  it('changes when field, order, direction or nulls change', () => {
    const base = hash({ field: 'a', direction: 'asc' }, { field: 'id', direction: 'asc' });
    expect(hash({ field: 'b', direction: 'asc' }, { field: 'id', direction: 'asc' })).not.toBe(
      base,
    );
    expect(hash({ field: 'id', direction: 'asc' }, { field: 'a', direction: 'asc' })).not.toBe(
      base,
    );
    expect(hash({ field: 'a', direction: 'desc' }, { field: 'id', direction: 'asc' })).not.toBe(
      base,
    );
    expect(
      hash({ field: 'a', direction: 'asc', nulls: 'first' }, { field: 'id', direction: 'asc' }),
    ).not.toBe(base);
  });
});
