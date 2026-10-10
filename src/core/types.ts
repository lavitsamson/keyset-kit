/** Sort direction for a single field. */
export type SortDirection = 'asc' | 'desc';

/**
 * One column of a sort specification.
 *
 * @example
 * ```ts
 * const byNewest: SortField<Post> = { field: 'createdAt', direction: 'desc' };
 * ```
 */
export interface SortField<T> {
  /** Model field to sort by. Inferred from the model type. */
  field: keyof T & string;
  direction: SortDirection;
  /** Where `null` values sort. Defaults to the database's native behaviour. */
  nulls?: 'first' | 'last';
}

/**
 * Options accepted by `toPage` and every adapter.
 *
 * @example
 * ```ts
 * const options: PaginateOptions<Post> = {
 *   sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
 *   limit: 20,
 *   after: req.query.after,
 * };
 * ```
 */
export interface PaginateOptions<T> {
  /** Sort specification. Must end with a unique field (e.g. `id`) so ordering is total. */
  sort: SortField<T>[];
  /** Page size. Defaults to 20. */
  limit?: number;
  /** Upper bound for `limit`; larger requests are clamped. Defaults to 100. */
  maxLimit?: number;
  /** Cursor to continue forwards from. */
  after?: string | null;
  /** Cursor to continue backwards from. */
  before?: string | null;
  /** When set, cursors are HMAC-SHA256 signed and verified with this secret. */
  secret?: string;
}

/** Navigation metadata for a page. */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

/** A page of results plus navigation metadata. */
export interface Page<T> {
  data: T[];
  pageInfo: PageInfo;
}
