// Shared conformance suite: every adapter must pass these tests against a real database.
// Each adapter test file provides a ConformanceTarget backed by its ORM and database.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveSort } from '../../src/core/sort.js';
import {
  encodeCursor,
  InvalidCursorError,
  type Page,
  type PaginateOptions,
  type SortDirection,
  type SortField,
} from '../../src/index.js';
import { compareRows } from '../unit/helpers/memory.js';

/** Conformance model. Every column except `id` is nullable and has few distinct values. */
export interface Item {
  id: number;
  a: number | null;
  b: string | null;
  /** Millisecond precision; stored as timestamp(3). */
  c: Date | null;
  /** Values above 2^53, to prove bigints survive cursors. */
  d: bigint | null;
  /** Decimal column, normalised to a number by the target (values are exact in binary). */
  e: number | null;
}

export interface ConformanceTarget {
  /** Replace every row in the table. */
  reset(rows: readonly Item[]): Promise<void>;
  insert(rows: readonly Item[]): Promise<void>;
  /**
   * Paginate through the adapter, optionally restricted to rows where `b` equals `filter.b`.
   * Returned rows are normalised to `Item` after the adapter has built its cursors.
   */
  paginate(options: PaginateOptions<Item>, filter?: { b: string }): Promise<Page<Item>>;
  /**
   * Set when the database cannot change where nulls sort. `'smallest'` (MongoDB): nulls come first
   * ascending and last descending. The suite then only generates sorts with that null order.
   */
  fixedNullOrder?: 'smallest';
}

type Columns = Omit<Item, 'id'>;
type Nulls = 'first' | 'last' | undefined;

const BASE_DATE = Date.UTC(2026, 0, 1);
const columnsArb: fc.Arbitrary<Columns> = fc.record({
  a: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
  b: fc.option(fc.constantFrom('x', 'y', 'z'), { nil: null }),
  c: fc.option(
    fc.integer({ min: 0, max: 3 }).map((n) => new Date(BASE_DATE + n * 1001)),
    { nil: null },
  ),
  d: fc.option(
    fc.integer({ min: 0, max: 3 }).map((n) => 2n ** 60n + BigInt(n)),
    { nil: null },
  ),
  e: fc.option(
    fc.integer({ min: 0, max: 3 }).map((n) => n / 4),
    { nil: null },
  ),
});

const withIds = (rows: readonly Columns[], start = 1): Item[] =>
  rows.map((row, i) => ({ id: start + i, ...row }));

const datasetArb = fc.array(columnsArb, { maxLength: 30 }).map((rows) => withIds(rows));

const sortArb = fc
  .tuple(
    fc.shuffledSubarray(['a', 'b', 'c', 'd', 'e'] as const, { maxLength: 3 }),
    fc.array(fc.constantFrom<SortDirection>('asc', 'desc'), { minLength: 4, maxLength: 4 }),
    fc.array(fc.constantFrom<Nulls>(undefined, 'first', 'last'), { minLength: 3, maxLength: 3 }),
  )
  .map(([fields, directions, nulls]): SortField<Item>[] => [
    ...fields.map((field, i): SortField<Item> => {
      const direction = directions[i] ?? 'asc';
      const n = nulls[i];
      return n === undefined ? { field, direction } : { field, direction, nulls: n };
    }),
    { field: 'id', direction: directions[3] ?? 'asc' },
  ]);

interface Base {
  sort: SortField<Item>[];
  limit: number;
  secret?: string;
}

const baseArb = fc
  .record({ sort: sortArb, limit: fc.integer({ min: 1, max: 7 }), signed: fc.boolean() })
  .map(({ sort, limit, signed }): Base =>
    signed ? { sort, limit, secret: 'conformance' } : { sort, limit },
  );

const RUNS = { numRuns: 40 };
const ids = (rows: readonly Item[]): number[] => rows.map((r) => r.id);
const sortedIds = (rows: readonly Item[], sort: SortField<Item>[]): number[] =>
  ids([...rows].sort(compareRows(resolveSort(sort))));

export function runConformanceSuite(name: string, target: () => ConformanceTarget): void {
  /** Pins every field's null order to the database's fixed order, when it has one. */
  const adapt = (base: Base): Base =>
    target().fixedNullOrder === 'smallest'
      ? {
          ...base,
          sort: base.sort.map((s) => ({ ...s, nulls: s.direction === 'asc' ? 'first' : 'last' })),
        }
      : base;
  const adaptedBaseArb = baseArb.map(adapt);

  async function walkForward(base: Base, filter?: { b: string }): Promise<Item[]> {
    const seen: Item[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const page: Page<Item> = await target().paginate({ ...base, after }, filter);
      seen.push(...page.data);
      if (!page.pageInfo.hasNextPage) return seen;
      after = page.pageInfo.endCursor;
    }
    throw new Error('forward walk did not terminate');
  }

  describe(`${name} conformance`, () => {
    it('walking forward matches the fully sorted result', async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, adaptedBaseArb, async (rows, base) => {
          await target().reset(rows);
          expect(ids(await walkForward(base))).toEqual(sortedIds(rows, base.sort));
        }),
        RUNS,
      );
    });

    it('walking backward from the last row matches the fully sorted result', async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, adaptedBaseArb, async (rows, base) => {
          await target().reset(rows);
          const expected = sortedIds(rows, base.sort);
          const lastId = expected.at(-1);
          const last = rows.find((r) => r.id === lastId);
          if (!last) return;

          const cursorOptions =
            base.secret === undefined
              ? { sort: base.sort }
              : { sort: base.sort, secret: base.secret };
          let before: string | null = encodeCursor({ ...last }, cursorOptions);
          const pages: Item[][] = [];
          for (let guard = 0; guard < 100; guard++) {
            const page: Page<Item> = await target().paginate({ ...base, before });
            pages.unshift(page.data);
            if (!page.pageInfo.hasPreviousPage) break;
            before = page.pageInfo.startCursor;
          }
          expect([...ids(pages.flat()), last.id]).toEqual(expected);
        }),
        RUNS,
      );
    });

    it('combines a caller filter with the keyset condition', async () => {
      await fc.assert(
        fc.asyncProperty(datasetArb, adaptedBaseArb, async (rows, base) => {
          await target().reset(rows);
          const matching = rows.filter((r) => r.b === 'x');
          expect(ids(await walkForward(base, { b: 'x' }))).toEqual(sortedIds(matching, base.sort));
        }),
        RUNS,
      );
    });

    it('never duplicates or skips existing rows when rows are inserted between requests', async () => {
      const insertsArb = fc.array(fc.array(columnsArb, { maxLength: 3 }), { maxLength: 10 });
      await fc.assert(
        fc.asyncProperty(datasetArb, adaptedBaseArb, insertsArb, async (initial, base, inserts) => {
          await target().reset(initial);
          let nextId = initial.length + 1;
          const seen: Item[] = [];
          let after: string | null = null;

          for (let step = 0; step < 200; step++) {
            const page: Page<Item> = await target().paginate({ ...base, after });
            seen.push(...page.data);
            if (!page.pageInfo.hasNextPage) break;
            after = page.pageInfo.endCursor;
            const batch = withIds(inserts[step] ?? [], nextId);
            nextId += batch.length;
            await target().insert(batch);
          }

          const seenIds = ids(seen);
          expect(new Set(seenIds).size).toBe(seenIds.length);
          for (const row of initial) expect(seenIds).toContain(row.id);
        }),
        RUNS,
      );
    });

    it('keeps millisecond timestamps, large bigints and decimals exact across cursors', async () => {
      const rows: Item[] = [0, 1, 2, 3].map((n) => ({
        id: 10 - n,
        a: null,
        b: null,
        c: new Date(BASE_DATE + n), // 1 ms apart
        d: 2n ** 60n + BigInt(n % 2), // ties broken by id
        e: 0.25,
      }));
      await target().reset(rows);
      for (const sort of [
        [
          { field: 'c', direction: 'asc' },
          { field: 'id', direction: 'asc' },
        ],
        [
          { field: 'd', direction: 'desc' },
          { field: 'id', direction: 'asc' },
        ],
        [
          { field: 'e', direction: 'asc' },
          { field: 'id', direction: 'desc' },
        ],
      ] satisfies SortField<Item>[][]) {
        expect(ids(await walkForward({ sort, limit: 1 }))).toEqual(sortedIds(rows, sort));
      }
    });

    it('rejects invalid, tampered and mismatched cursors with InvalidCursorError', async () => {
      await target().reset(withIds([{ a: 1, b: 'x', c: null, d: null, e: null }]));
      const sort: SortField<Item>[] = [{ field: 'id', direction: 'asc' }];
      const signed = encodeCursor({ id: 1 }, { sort, secret: 's' });
      const otherSort = encodeCursor(
        { a: 1, id: 1 },
        { sort: [{ field: 'a', direction: 'asc' }, ...sort] },
      );

      const cases: [PaginateOptions<Item>, string][] = [
        [{ sort, after: 'garbage!' }, 'INVALID_CURSOR'],
        [{ sort, after: signed, secret: 'wrong' }, 'TAMPERED_CURSOR'],
        [{ sort, after: otherSort }, 'SORT_MISMATCH'],
      ];
      for (const [options, code] of cases) {
        const error: unknown = await target()
          .paginate(options)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(InvalidCursorError);
        expect((error as InvalidCursorError).code).toBe(code);
      }
    });
  });
}
