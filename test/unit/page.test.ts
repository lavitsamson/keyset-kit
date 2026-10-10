import { describe, expect, it } from 'vitest';
import { preparePagination } from '../../src/core/page.js';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  toPage,
  type PaginateOptions,
  type SortField,
} from '../../src/index.js';
import { paginateMemory } from './helpers/memory.js';

interface Post {
  id: number;
  score: number;
}

const sort: SortField<Post>[] = [
  { field: 'score', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];
const posts = (count: number): Post[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, score: i % 3 }));

describe('limits', () => {
  it('defaults to 20 rows per page', () => {
    const page = paginateMemory(posts(25), { sort });
    expect(page.data).toHaveLength(20);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it('clamps to maxLimit (default 100)', () => {
    expect(paginateMemory(posts(150), { sort, limit: 500 }).data).toHaveLength(100);
    expect(paginateMemory(posts(150), { sort, limit: 50, maxLimit: 10 }).data).toHaveLength(10);
    expect(paginateMemory(posts(150), { sort, maxLimit: 5 }).data).toHaveLength(5);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects limit %s with an actionable message',
    (limit) => {
      expect(() => toPage([], { sort, limit })).toThrow(RangeError);
      expect(() => toPage([], { sort, limit })).toThrow(/`limit` must be a positive integer/);
    },
  );

  it('rejects an invalid maxLimit', () => {
    expect(() => toPage([], { sort, maxLimit: 0 })).toThrow(
      /`maxLimit` must be a positive integer/,
    );
  });
});

describe('toPage', () => {
  it('trims the extra row and reports a next page', () => {
    const rows = posts(4);
    const page = toPage(rows, { sort, limit: 3 });
    expect(page.data).toEqual(rows.slice(0, 3));
    expect(page.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
  });

  it('reports the last page and a previous page when continuing from a cursor', () => {
    const after = encodeCursor({ score: 9, id: 0 }, { sort });
    const page = toPage(posts(2), { sort, limit: 3, after });
    expect(page.data).toHaveLength(2);
    expect(page.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it('restores the requested order for "before" and reports pages on both sides', () => {
    const before = encodeCursor({ score: 0, id: 99 }, { sort });
    const reversed = posts(4).reverse(); // rows arrive in reversed query order
    const page = toPage(reversed, { sort, limit: 3, before });
    expect(page.data.map((p) => p.id)).toEqual([2, 3, 4]);
    expect(page.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: true });

    const first = toPage(posts(2).reverse(), { sort, limit: 3, before });
    expect(first.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
  });

  it('returns null cursors for an empty page', () => {
    expect(toPage([], { sort })).toEqual({
      data: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
    });
  });

  it('builds cursors from the first and last rows, bound to the sort and signed when asked', () => {
    const secret = 'top secret';
    const page = toPage(posts(3), { sort, limit: 3, secret });
    const options = { sort, secret };
    expect(decodeCursor(page.pageInfo.startCursor ?? '', options)).toEqual({ score: 0, id: 1 });
    expect(decodeCursor(page.pageInfo.endCursor ?? '', options)).toEqual({ score: 2, id: 3 });
  });

  it('does not mutate the input rows', () => {
    const rows = posts(4).reverse();
    const copy = [...rows];
    toPage(rows, { sort, limit: 3, before: encodeCursor({ score: 0, id: 99 }, { sort }) });
    expect(rows).toEqual(copy);
  });

  it('rejects after and before together', () => {
    expect(() => toPage([], { sort, after: 'a', before: 'b' })).toThrow(
      /either `after` or `before`/,
    );
  });

  describe('tie-breaker check', () => {
    it('rejects rows that repeat the last sort field', () => {
      const rows = [
        { id: 1, score: 1 },
        { id: 1, score: 0 },
      ];
      expect(() => toPage(rows, { sort })).toThrow(/two rows share "id"/);
    });

    it('rejects rows with a missing or null tie-breaker', () => {
      expect(() => toPage([{ score: 1 } as Post], { sort })).toThrow(/a row has no "id"/);
      expect(() => toPage([{ id: null, score: 1 } as unknown as Post], { sort })).toThrow(
        /must be unique, non-null/,
      );
    });

    it('compares Date and object tie-breakers by value', () => {
      const byDate: SortField<{ at: Date }>[] = [{ field: 'at', direction: 'asc' }];
      expect(() => toPage([{ at: new Date(1) }, { at: new Date(1) }], { sort: byDate })).toThrow(
        /share "at"/,
      );

      const oid = (hex: string) => ({
        _bsontype: 'ObjectId',
        toHexString: () => hex,
        toString: () => hex,
      });
      const byId: SortField<{ _id: object }>[] = [{ field: '_id', direction: 'asc' }];
      const a = '65f1c0ffee0123456789abcd';
      const b = '65f1c0ffee0123456789abce';
      expect(toPage([{ _id: oid(a) }, { _id: oid(b) }], { sort: byId }).data).toHaveLength(2);
      expect(() => toPage([{ _id: oid(a) }, { _id: oid(a) }], { sort: byId })).toThrow(
        /share "_id"/,
      );
    });
  });
});

describe('preparePagination', () => {
  it('has no condition on the first page and fetches limit + 1 rows', () => {
    expect(preparePagination({ sort, limit: 10 })).toEqual({
      sort: [
        { field: 'score', direction: 'desc', nulls: 'first', explicitNulls: false },
        { field: 'id', direction: 'asc', nulls: 'last', explicitNulls: false },
      ],
      where: null,
      take: 11,
      limit: 10,
      direction: 'after',
    });
  });

  it('builds the keyset condition from an "after" cursor', () => {
    const after = encodeCursor({ score: 2, id: 5 }, { sort });
    expect(preparePagination({ sort, after }).where).toEqual({
      type: 'and',
      conditions: [
        { type: 'compare', field: 'score', operator: 'lte', value: 2 },
        {
          type: 'or',
          conditions: [
            { type: 'compare', field: 'score', operator: 'lt', value: 2 },
            {
              type: 'and',
              conditions: [
                { type: 'compare', field: 'score', operator: 'eq', value: 2 },
                { type: 'compare', field: 'id', operator: 'gt', value: 5 },
              ],
            },
          ],
        },
      ],
    });
  });

  it('reverses the query order for "before"', () => {
    const before = encodeCursor({ score: 2, id: 5 }, { sort });
    const prepared = preparePagination({ sort, before });
    expect(prepared.direction).toBe('before');
    expect(prepared.sort).toEqual([
      { field: 'score', direction: 'asc', nulls: 'last', explicitNulls: false },
      { field: 'id', direction: 'desc', nulls: 'first', explicitNulls: false },
    ]);
  });

  it('treats null cursors as the first page', () => {
    expect(preparePagination({ sort, after: null, before: null }).where).toBeNull();
  });

  it('surfaces cursor problems as InvalidCursorError', () => {
    const otherSort: PaginateOptions<Post>['sort'] = [{ field: 'id', direction: 'asc' }];
    const foreign = encodeCursor({ id: 1 }, { sort: otherSort });
    expect(() => preparePagination({ sort, after: foreign })).toThrow(InvalidCursorError);
    expect(() => preparePagination({ sort, after: 'garbage!' })).toThrow(InvalidCursorError);
    expect(() =>
      preparePagination({ sort, after: encodeCursor({ score: 1, id: 1 }, { sort }), secret: 'x' }),
    ).toThrow(/not signed/);
  });
});
