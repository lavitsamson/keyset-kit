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
  /** `'asc'` (smallest first) or `'desc'` (largest first). */
  direction: SortDirection;
  /**
   * Where `null` values sort. Defaults to PostgreSQL's behaviour: nulls count as larger than
   * any value, so they come `last` ascending and `first` descending.
   */
  nulls?: 'first' | 'last' | undefined;
  /**
   * Set to `false` for a column that can never be null (`NOT NULL`). The keyset condition then
   * skips `IS NULL` branches, so ascending sorts and backwards pages stay index range scans.
   * Defaults to `true`, which is always correct. The TypeORM adapter detects `NOT NULL` columns
   * itself; the last sort field is always treated as non-null.
   */
  nullable?: boolean | undefined;
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
  /** More rows follow this page. When paginating backwards, true whenever a cursor was given. */
  hasNextPage: boolean;
  /** Rows precede this page. When paginating forwards, true whenever a cursor was given. */
  hasPreviousPage: boolean;
  /** Cursor of the first row; pass it as `before` for the previous page. `null` if empty. */
  startCursor: string | null;
  /** Cursor of the last row; pass it as `after` for the next page. `null` if empty. */
  endCursor: string | null;
}

/** A page of results plus navigation metadata. */
export interface Page<T> {
  /** The rows of this page, in the requested order. */
  data: T[];
  /** Cursors and whether neighbouring pages exist. */
  pageInfo: PageInfo;
}

/**
 * Structural shape shared by every `SortField<T>`. Used where the model type is irrelevant: since
 * `SortField<T>` is contravariant in `T`, `SortField<Post>` is not assignable to `SortField<object>`.
 */
export interface AnySortField {
  /** Field to sort by. */
  field: string;
  /** `'asc'` or `'desc'`. */
  direction: SortDirection;
  /** Where `null` values sort; omitted means the database's default. */
  nulls?: 'first' | 'last' | undefined;
  /** `false` if the field can never be null. */
  nullable?: boolean | undefined;
}

declare const parsedSortBrand: unique symbol;

/**
 * A sort spec parsed from user input and checked against an allow-list at runtime, as produced by
 * `keysetParams()` from `keyset-kit/express`. Its field names are plain strings, so the brand is
 * what lets it stand in for a model-typed sort. Hand-written arrays never carry it.
 */
export type ParsedSort = readonly AnySortField[] & {
  /** Type-only brand; never present at runtime. */
  readonly [parsedSortBrand]: true;
};

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
 * ORM-agnostic description of "rows strictly past the cursor", built by `buildKeysetCondition`.
 * Adapters translate it into a Prisma `where`, TypeORM SQL or a MongoDB filter.
 */
export type KeysetCondition =
  KeysetAndCondition | KeysetOrCondition | KeysetCompareCondition | KeysetNullCondition;

/** Matches when every child condition matches. */
export interface KeysetAndCondition {
  /** Node kind. */
  type: 'and';
  /** Conditions combined with AND. */
  conditions: KeysetCondition[];
}

/** Matches when any child condition matches. */
export interface KeysetOrCondition {
  /** Node kind. */
  type: 'or';
  /** Conditions combined with OR. */
  conditions: KeysetCondition[];
}

/** `field <operator> value`. Never matches a row whose field is null (SQL semantics). */
export interface KeysetCompareCondition {
  /** Node kind. */
  type: 'compare';
  /** Field to compare. */
  field: string;
  /** `gt` (>), `gte` (>=), `lt` (<), `lte` (<=) or `eq` (=). */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  /** Cursor value, as decoded (Date, bigint, string, number, boolean). */
  value: unknown;
}

/** `field IS NULL` (`isNull: true`) or `field IS NOT NULL` (`isNull: false`). */
export interface KeysetNullCondition {
  /** Node kind. */
  type: 'null';
  /** Field to test. */
  field: string;
  /** `true` for IS NULL, `false` for IS NOT NULL. */
  isNull: boolean;
}
