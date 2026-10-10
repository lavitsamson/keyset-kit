import { buildResolvedCondition } from './condition.js';
import { decodeResolved, encodeResolved } from './cursor.js';
import { resolveSort, reverseSort, type ResolvedSortField } from './sort.js';
import type { KeysetCondition, Page, PaginateOptions, PaginationDirection } from './types.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_LIMIT = 100;

/** @internal Everything an adapter needs to build its query. */
export interface PreparedPagination {
  /** Order the query must use: the requested order, or its exact reverse for `before`. */
  sort: ResolvedSortField[];
  /** Keyset filter, or `null` on the first page. Combine it with the caller's own filter using AND. */
  where: KeysetCondition | null;
  /** Rows to fetch: `limit + 1`, so `toPage` can tell whether another page exists. */
  take: number;
  limit: number;
  direction: PaginationDirection;
}

/**
 * @internal Validates options, decodes the cursor and builds the keyset condition.
 * Adapters run the query with this, then hand the rows to `toPage`.
 */
export function preparePagination<T>(options: PaginateOptions<T>): PreparedPagination {
  const { sort, limit, direction } = resolveOptions(options);
  const cursor = direction === 'before' ? options.before : options.after;
  const querySort = direction === 'before' ? reverseSort(sort) : sort;
  const where =
    cursor == null
      ? null
      : buildResolvedCondition(querySort, decodeResolved(cursor, sort, options.secret));
  return { sort: querySort, where, take: limit + 1, limit, direction };
}

/**
 * Turns the rows of a keyset query into a page. Fetch `limit + 1` rows in query order (reversed
 * for `before`); `toPage` drops the extra row, restores the requested order and builds `pageInfo`.
 *
 * `hasPreviousPage` (forwards) and `hasNextPage` (backwards) report whether a cursor was supplied,
 * avoiding an extra query. This is the approximation the Relay connection spec allows.
 *
 * @example
 * ```ts
 * const rows = await db.query(sql, [..., limit + 1]);
 * const page = toPage(rows, { sort, limit, after: req.query.after });
 * res.json(page); // { data, pageInfo: { hasNextPage, endCursor, ... } }
 * ```
 */
export function toPage<T>(rows: readonly T[], options: PaginateOptions<T>): Page<T> {
  const { sort, limit, direction } = resolveOptions(options);
  assertUniqueTieBreaker(rows, sort);

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  if (direction === 'before') data.reverse();

  const first = data[0];
  const last = data[data.length - 1];
  const cursorFor = (row: T): string =>
    encodeResolved(row as Record<string, unknown>, sort, options.secret);

  return {
    data,
    pageInfo: {
      hasNextPage: direction === 'after' ? hasMore : true,
      hasPreviousPage: direction === 'after' ? options.after != null : hasMore,
      startCursor: first === undefined ? null : cursorFor(first),
      endCursor: last === undefined ? null : cursorFor(last),
    },
  };
}

function resolveOptions<T>(options: PaginateOptions<T>): {
  sort: ResolvedSortField[];
  limit: number;
  direction: PaginationDirection;
} {
  if (options.after != null && options.before != null) {
    throw new TypeError('keyset-kit: pass either `after` or `before`, not both.');
  }
  const maxLimit = positiveInteger('maxLimit', options.maxLimit ?? DEFAULT_MAX_LIMIT);
  const limit = positiveInteger('limit', options.limit ?? DEFAULT_LIMIT);
  return {
    sort: resolveSort(options.sort),
    limit: Math.min(limit, maxLimit),
    direction: options.before != null ? 'before' : 'after',
  };
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `keyset-kit: \`${name}\` must be a positive integer, got ${String(value)}.`,
    );
  }
  return value;
}

/**
 * Keyset pagination needs a total order, so the last sort field must be unique and non-null.
 * The schema isn't visible here, so check what we can: no nulls and no repeats within the rows.
 */
function assertUniqueTieBreaker(
  rows: readonly unknown[],
  sort: readonly ResolvedSortField[],
): void {
  const field = sort[sort.length - 1]?.field;
  if (field === undefined) return;
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (row as Record<string, unknown>)[field];
    if (value === null || value === undefined) {
      throw new TypeError(
        `keyset-kit: a row has no "${field}". The last sort field must be unique, non-null and selected.`,
      );
    }
    const key = identity(value);
    if (seen.has(key)) {
      throw new TypeError(
        `keyset-kit: two rows share "${field}"; end the sort with a unique field such as id.`,
      );
    }
    seen.add(key);
  }
}

function identity(value: unknown): string {
  if (value instanceof Date) return `d:${String(value.getTime())}`;
  // ObjectId, Decimal and friends identify themselves through toString().
  if (typeof value === 'object' && value !== null)
    return `o:${(value as { toString(): string }).toString()}`;
  return `${typeof value}:${String(value)}`;
}
