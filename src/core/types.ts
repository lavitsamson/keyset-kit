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
  /**
   * Where `null` values sort. Defaults to PostgreSQL's behaviour: nulls count as larger than
   * any value, so they come `last` ascending and `first` descending.
   */
  nulls?: 'first' | 'last' | undefined;
}

/**
 * Options accepted by `toPage` and every adapter. Optional fields also accept `undefined`, so values
 * such as `process.env.CURSOR_SECRET` or `req.query.after` can be passed straight through.
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
  /**
   * Sort specification. Must end with a unique, non-null field (e.g. `id`) so ordering is total.
   * Either written against the model (field names are type-checked) or a `ParsedSort` from the
   * Express middleware (checked against its allow-list at runtime).
   */
  sort: readonly SortField<T>[] | ParsedSort;
  /** Page size. Defaults to 20. */
  limit?: number | undefined;
  /** Upper bound for `limit`; larger requests are clamped. Defaults to 100. */
  maxLimit?: number | undefined;
  /** Cursor to continue forwards from. */
  after?: string | null | undefined;
  /** Cursor to continue backwards from. */
  before?: string | null | undefined;
  /** When set, cursors are HMAC-SHA256 signed and verified with this secret. */
  secret?: string | undefined;
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

/**
 * Structural shape shared by every `SortField<T>`. Used where the model type is irrelevant: since
 * `SortField<T>` is contravariant in `T`, `SortField<Post>` is not assignable to `SortField<object>`.
 */
export interface AnySortField {
  field: string;
  direction: SortDirection;
  nulls?: 'first' | 'last' | undefined;
}

declare const parsedSortBrand: unique symbol;

/**
 * A sort spec parsed from user input and checked against an allow-list at runtime, as produced by
 * `keysetParams()` from `keyset-kit/express`. Its field names are plain strings, so the brand is
 * what lets it stand in for a model-typed sort. Hand-written arrays never carry it.
 */
export type ParsedSort = readonly AnySortField[] & { readonly [parsedSortBrand]: true };

/** Options for `encodeCursor` and `decodeCursor`. */
export interface CursorOptions {
  /** Sign (encode) or verify (decode) the cursor with HMAC-SHA256. */
  secret?: string | undefined;
  /**
   * Bind the cursor to this sort specification. On encode, only the sort fields are stored and a
   * hash of the spec is embedded; on decode, a cursor made under a different spec is rejected
   * with `SORT_MISMATCH`.
   */
  sort?: readonly AnySortField[] | undefined;
}

/** Which side of the cursor a page lies on. */
export type PaginationDirection = 'after' | 'before';

/**
 * ORM-agnostic description of "rows strictly past the cursor". Adapters translate it into
 * Prisma `where`, TypeORM brackets or a MongoDB filter.
 *
 * - `compare`: `field <operator> value`; never matches a row whose field is null.
 * - `null`: `field IS NULL` (`isNull: true`) or `field IS NOT NULL` (`isNull: false`).
 */
export type KeysetCondition =
  | { type: 'and'; conditions: KeysetCondition[] }
  | { type: 'or'; conditions: KeysetCondition[] }
  | { type: 'compare'; field: string; operator: 'gt' | 'lt' | 'eq'; value: unknown }
  | { type: 'null'; field: string; isNull: boolean };
