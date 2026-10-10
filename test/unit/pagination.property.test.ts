import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveSort } from '../../src/core/sort.js';
import { encodeCursor, type Page, type SortDirection, type SortField } from '../../src/index.js';
import { compareRows, paginateMemory } from './helpers/memory.js';

interface Item {
  id: number;
  a: number | null;
  b: string | null;
  c: Date | null;
  d: bigint | null;
  /** Never null, so sorts may declare it `nullable: false`. */
  e: number;
}

type Nulls = 'first' | 'last' | undefined;
const FIELDS = ['a', 'b', 'c', 'd', 'e'] as const;

// Few distinct values per column, so duplicates and nulls are common.
const columnsArb = fc.record({
  a: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  b: fc.option(fc.constantFrom('x', 'y', 'z'), { nil: null }),
  c: fc.option(
    fc.integer({ min: 0, max: 3 }).map((n) => new Date(Date.UTC(2026, 0, 1 + n))),
    { nil: null },
  ),
  d: fc.option(fc.bigInt({ min: 0n, max: 3n }), { nil: null }),
  e: fc.integer({ min: 0, max: 4 }),
});

const withIds = (rows: Omit<Item, 'id'>[], start = 1): Item[] =>
  rows.map((row, i) => ({ id: start + i, ...row }));

const datasetArb = fc.array(columnsArb, { maxLength: 50 }).map((rows) => withIds(rows));

const directionArb = fc.constantFrom<SortDirection>('asc', 'desc');
const nullsArb = fc.constantFrom<Nulls>(undefined, 'first', 'last');

// Random subset/order of the non-unique columns, each with random direction and nulls,
// always ending with the unique `id` tie-breaker. The never-null `e` is sometimes declared
// `nullable: false`, which drops its IS NULL branches.
const sortArb = fc
  .tuple(
    fc.shuffledSubarray([...FIELDS]),
    fc.array(directionArb, { minLength: 6, maxLength: 6 }),
    fc.array(nullsArb, { minLength: 6, maxLength: 6 }),
    fc.boolean(),
  )
  .map(([fields, directions, nulls, declareNonNull]): SortField<Item>[] => {
    const spec = fields.map((field, i): SortField<Item> => {
      const direction = directions[i] ?? 'asc';
      const n = nulls[i];
      const s: SortField<Item> =
        n === undefined ? { field, direction } : { field, direction, nulls: n };
      return field === 'e' && declareNonNull ? { ...s, nullable: false } : s;
    });
    return [...spec, { field: 'id', direction: directions[5] ?? 'asc' }];
  });

const secretArb = fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined });

interface Base {
  sort: SortField<Item>[];
  limit: number;
  secret?: string;
}

const baseArb = fc
  .record({ sort: sortArb, limit: fc.integer({ min: 1, max: 8 }), secret: secretArb })
  .map(({ sort, limit, secret }): Base =>
    secret === undefined ? { sort, limit } : { sort, limit, secret },
  );

const ids = (rows: readonly Item[]): number[] => rows.map((r) => r.id);
const sorted = (rows: readonly Item[], sort: SortField<Item>[]): Item[] =>
  [...rows].sort(compareRows(resolveSort(sort)));

function forwardPages(rows: readonly Item[], base: Base): Page<Item>[] {
  const pages: Page<Item>[] = [];
  let after: string | null = null;
  for (let guard = 0; guard <= rows.length + 1; guard++) {
    const page: Page<Item> = paginateMemory(rows, { ...base, after });
    pages.push(page);
    if (!page.pageInfo.hasNextPage) return pages;
    after = page.pageInfo.endCursor;
  }
  throw new Error('forward walk did not terminate');
}

describe('pagination properties', () => {
  it('walking forward yields exactly the fully sorted sequence (no duplicates, no gaps)', () => {
    fc.assert(
      fc.property(datasetArb, baseArb, (rows, base) => {
        const walked = forwardPages(rows, base).flatMap((p) => p.data);
        expect(ids(walked)).toEqual(ids(sorted(rows, base.sort)));
      }),
      { numRuns: 300 },
    );
  });

  it('walking backward from the last row yields exactly the fully sorted sequence', () => {
    fc.assert(
      fc.property(datasetArb, baseArb, (rows, base) => {
        const expected = sorted(rows, base.sort);
        const last = expected.at(-1);
        if (last === undefined) return;

        const cursorOptions =
          base.secret === undefined
            ? { sort: base.sort }
            : { sort: base.sort, secret: base.secret };
        let before: string | null = encodeCursor({ ...last }, cursorOptions);
        const pages: Item[][] = [];
        for (let guard = 0; guard <= rows.length + 1; guard++) {
          const page: Page<Item> = paginateMemory(rows, { ...base, before });
          pages.unshift(page.data);
          if (!page.pageInfo.hasPreviousPage) break;
          before = page.pageInfo.startCursor;
        }

        expect(ids([...pages.flat(), last])).toEqual(ids(expected));
      }),
      { numRuns: 300 },
    );
  });

  it('paging back from any page returns exactly the page before it', () => {
    fc.assert(
      fc.property(datasetArb, baseArb, (rows, base) => {
        const pages = forwardPages(rows, base);
        pages.forEach((page, i) => {
          const before = pages[i - 1];
          if (before === undefined || page.data.length === 0) return;
          const previous = paginateMemory(rows, { ...base, before: page.pageInfo.startCursor });
          expect(ids(previous.data)).toEqual(ids(before.data));
          expect(previous.pageInfo.hasPreviousPage).toBe(i > 1);
        });
      }),
    );
  });

  it('inserting rows between requests never duplicates or skips previously existing rows', () => {
    const insertsArb = fc.array(fc.array(columnsArb, { maxLength: 3 }), { maxLength: 20 });

    fc.assert(
      fc.property(datasetArb, baseArb, insertsArb, (initial, base, inserts) => {
        const rows = [...initial];
        const compare = compareRows(resolveSort(base.sort));
        const seen: Item[] = [];
        let after: string | null = null;
        let done = false;

        // Every page holds at least one row, so the walk ends within (all rows ever) + 1 steps.
        const maxSteps = initial.length + inserts.flat().length + 1;
        for (let step = 0; step < maxSteps && !done; step++) {
          const page: Page<Item> = paginateMemory(rows, { ...base, after });
          seen.push(...page.data);
          done = !page.pageInfo.hasNextPage;
          after = page.pageInfo.endCursor;
          rows.push(...withIds(inserts[step] ?? [], rows.length + 1));
        }
        expect(done).toBe(true);

        expect(new Set(ids(seen)).size).toBe(seen.length);
        const seenIds = new Set(ids(seen));
        for (const row of initial) expect(seenIds.has(row.id)).toBe(true);
        for (const [i, row] of seen.entries()) {
          const previous = seen[i - 1];
          if (previous) expect(compare(previous, row)).toBeLessThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});
