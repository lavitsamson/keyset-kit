import type { AnySortField, SortDirection } from './types.js';

/**
 * Where a database puts nulls for fields without an explicit `nulls` option.
 * `largest`: PostgreSQL (last ascending, first descending). `smallest`: MongoDB (the reverse).
 */
export type NullOrder = 'largest' | 'smallest';

/** A sort field whose null ordering has been made explicit. */
export interface ResolvedSortField {
  field: string;
  direction: SortDirection;
  nulls: 'first' | 'last';
  /** Whether `nulls` was set by the caller. Only declared options are part of the sort hash. */
  explicitNulls: boolean;
  /** `false` for the tie-breaker and fields declared `nullable: false`. Not part of the hash. */
  nullable: boolean;
}

/**
 * Validates a sort specification and resolves each field's null ordering, using the database's
 * default (`nullOrder`) where the caller did not set one.
 */
export function resolveSort(
  sort: readonly AnySortField[],
  nullOrder: NullOrder = 'largest',
): ResolvedSortField[] {
  const input: unknown = sort; // JavaScript callers may pass anything
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError(
      'keyset-kit: `sort` must be a non-empty array ending with a unique field such as id.',
    );
  }

  const seen = new Set<string>();
  return sort.map((s, i): ResolvedSortField => {
    const field: unknown = s.field;
    if (typeof field !== 'string' || field === '') {
      throw new TypeError(`keyset-kit: sort[${String(i)}].field must be a non-empty string.`);
    }
    if (seen.has(field)) {
      throw new TypeError(`keyset-kit: sort field "${field}" is listed twice.`);
    }
    seen.add(field);

    const direction: unknown = s.direction;
    if (direction !== 'asc' && direction !== 'desc') {
      throw new TypeError(
        `keyset-kit: sort field "${field}" has direction ${JSON.stringify(direction)}; use 'asc' or 'desc'.`,
      );
    }

    const nulls: unknown = s.nulls;
    if (nulls !== undefined && nulls !== 'first' && nulls !== 'last') {
      throw new TypeError(
        `keyset-kit: sort field "${field}" has nulls ${JSON.stringify(nulls)}; use 'first', 'last' or omit it.`,
      );
    }

    const nullsLast = (direction === 'asc') === (nullOrder === 'largest');
    return {
      field,
      direction,
      nulls: nulls ?? (nullsLast ? 'last' : 'first'),
      explicitNulls: nulls !== undefined,
      // Anything but an explicit `false` keeps the always-correct nullable conditions.
      nullable: i < sort.length - 1 && s.nullable !== false,
    };
  });
}

/**
 * Whether the null placement is PostgreSQL's default for the direction (last asc, first desc).
 * Adapters then omit an explicit NULLS clause, which keeps queries portable and index-friendly.
 */
export function hasDefaultNulls(s: ResolvedSortField): boolean {
  // Null placement is irrelevant for a column without nulls; a plain direction matches any index.
  return !s.nullable || s.nulls === (s.direction === 'asc' ? 'last' : 'first');
}

/** The exact reverse ordering, used to fetch the page before a cursor. */
export function reverseSort(sort: readonly ResolvedSortField[]): ResolvedSortField[] {
  return sort.map((s) => ({
    ...s,
    direction: s.direction === 'asc' ? 'desc' : 'asc',
    nulls: s.nulls === 'first' ? 'last' : 'first',
  }));
}

/**
 * Short, stable fingerprint of a sort spec as declared (32-bit FNV-1a, base36). Defaults filled in
 * for a particular database are left out, so the same declared sort hashes the same everywhere,
 * for example in the Express middleware and in the Mongoose adapter. It detects cursors reused under
 * a different sort; it is not a security measure.
 */
export function sortHash(sort: readonly ResolvedSortField[]): string {
  const canonical = JSON.stringify(
    sort.map((s) => [s.field, s.direction, s.explicitNulls ? s.nulls : null]),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
