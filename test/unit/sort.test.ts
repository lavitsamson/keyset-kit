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
      { field: 'a', direction: 'asc', nulls: 'last', explicitNulls: false, nullable: true },
      { field: 'id', direction: 'desc', nulls: 'first', explicitNulls: false, nullable: false },
    ]);
  });

  it("uses MongoDB's null order (smallest) when asked", () => {
    expect(
      resolveSort(
        spec({ field: 'a', direction: 'asc' }, { field: 'id', direction: 'desc' }),
        'smallest',
      ),
    ).toEqual([
      { field: 'a', direction: 'asc', nulls: 'first', explicitNulls: false, nullable: true },
      { field: 'id', direction: 'desc', nulls: 'last', explicitNulls: false, nullable: false },
    ]);
  });

  it('keeps an explicit nulls option', () => {
    expect(resolveSort(spec({ field: 'a', direction: 'asc', nulls: 'first' }), 'smallest')).toEqual(
      [{ field: 'a', direction: 'asc', nulls: 'first', explicitNulls: true, nullable: false }],
    );
  });

  it('marks the tie-breaker and nullable: false fields as non-nullable; anything else stays nullable', () => {
    const resolved = resolveSort([
      { field: 'a', direction: 'asc', nullable: false },
      { field: 'b', direction: 'asc', nullable: true },
      { field: 'c', direction: 'asc', nullable: 'false' }, // JavaScript callers: only `false` counts
      { field: 'id', direction: 'asc' },
    ] as unknown as SortField<Row>[]);
    expect(resolved.map((s) => s.nullable)).toEqual([false, true, true, false]);
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
    ).toThrow(/"id" is listed twice/);
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
        { field: 'a', direction: 'asc', nulls: 'last', explicitNulls: true, nullable: true },
        { field: 'id', direction: 'desc', nulls: 'first', explicitNulls: false, nullable: false },
      ]),
    ).toEqual([
      { field: 'a', direction: 'desc', nulls: 'first', explicitNulls: true, nullable: true },
      { field: 'id', direction: 'asc', nulls: 'last', explicitNulls: false, nullable: false },
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

  it('ignores nullable, which does not change the order', () => {
    expect(
      hash({ field: 'a', direction: 'asc', nullable: false }, { field: 'id', direction: 'asc' }),
    ).toBe(hash({ field: 'a', direction: 'asc' }, { field: 'id', direction: 'asc' }));
  });

  it('is the same whichever database default fills in the nulls (PostgreSQL or MongoDB)', () => {
    const declared = spec({ field: 'a', direction: 'asc' }, { field: 'id', direction: 'asc' });
    expect(sortHash(resolveSort(declared, 'smallest'))).toBe(
      sortHash(resolveSort(declared, 'largest')),
    );
  });

  it('includes a declared nulls option, even one equal to the default', () => {
    expect(hash({ field: 'a', direction: 'asc', nulls: 'last' })).not.toBe(
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
