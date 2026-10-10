import type { AnySortField, SortDirection } from './types.js';

/** A sort field whose null ordering has been made explicit. */
export interface ResolvedSortField {
  field: string;
  direction: SortDirection;
  nulls: 'first' | 'last';
}

/**
 * Validates a sort specification and resolves each field's null ordering.
 * Defaults follow PostgreSQL: nulls sort last ascending and first descending.
 */
export function resolveSort(sort: readonly AnySortField[]): ResolvedSortField[] {
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
      throw new TypeError(
        `keyset-kit: sort field "${field}" appears more than once; list each field once.`,
      );
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

    return { field, direction, nulls: nulls ?? (direction === 'asc' ? 'last' : 'first') };
  });
}

/**
 * Whether the null placement is PostgreSQL's default for the direction (last asc, first desc).
 * Adapters then omit an explicit NULLS clause, which keeps queries portable and index-friendly.
 */
export function hasDefaultNulls(s: ResolvedSortField): boolean {
  return s.nulls === (s.direction === 'asc' ? 'last' : 'first');
}

/** The exact reverse ordering, used to fetch the page before a cursor. */
export function reverseSort(sort: readonly ResolvedSortField[]): ResolvedSortField[] {
  return sort.map((s) => ({
    field: s.field,
    direction: s.direction === 'asc' ? 'desc' : 'asc',
    nulls: s.nulls === 'first' ? 'last' : 'first',
  }));
}

/**
 * Short, stable fingerprint of a resolved sort spec (32-bit FNV-1a, base36).
 * It detects cursors reused under a different sort; it is not a security measure.
 */
export function sortHash(sort: readonly ResolvedSortField[]): string {
  const canonical = JSON.stringify(sort.map((s) => [s.field, s.direction, s.nulls]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
