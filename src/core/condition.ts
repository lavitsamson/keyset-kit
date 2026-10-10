import { resolveSort, reverseSort, type ResolvedSortField } from './sort.js';
import type { KeysetCondition, PaginationDirection, SortField } from './types.js';

/**
 * Builds the ORM-agnostic condition matching rows strictly after (or before) the cursor.
 *
 * For `a asc, b asc, id asc` and cursor `(x, y, z)` this expands to
 * `(a > x) OR (a = x AND b > y) OR (a = x AND b = y AND id > z)`, honouring each field's
 * direction and null ordering. With `'before'`, the whole ordering is reversed. When it is safe,
 * a redundant bound on the first field (`a >= x`) is ANDed in front so an index can be used.
 *
 * @example
 * ```ts
 * const where = buildKeysetCondition<Post>(
 *   [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
 *   decodeCursor(after),
 *   'after',
 * );
 * // createdAt <= x AND (createdAt < x OR (createdAt = x AND id > y)), as nested
 * // { type: 'and' | 'or' | 'compare', ... } nodes
 * ```
 */
export function buildKeysetCondition<T>(
  sort: readonly SortField<T>[],
  cursorValues: Record<string, unknown>,
  direction: PaginationDirection,
): KeysetCondition {
  const resolved = resolveSort(sort);
  return buildResolvedCondition(
    direction === 'before' ? reverseSort(resolved) : resolved,
    cursorValues,
  );
}

/** @internal Build the "strictly after" condition for an already-resolved (and oriented) sort. */
export function buildResolvedCondition(
  sort: readonly ResolvedSortField[],
  values: Record<string, unknown>,
): KeysetCondition {
  const disjuncts: KeysetCondition[] = [];
  const equalities: KeysetCondition[] = [];

  sort.forEach((s) => {
    if (!Object.hasOwn(values, s.field) || values[s.field] === undefined) {
      throw new TypeError(`keyset-kit: cursor values are missing sort field "${s.field}".`);
    }
    const value = values[s.field];
    if (value === null && !s.nullable) throw nullInNonNullable(s.field);

    const after = strictlyAfter(s, value);
    if (after) disjuncts.push(all([...equalities, after]));
    equalities.push(
      value === null
        ? { type: 'null', field: s.field, isNull: true }
        : { type: 'compare', field: s.field, operator: 'eq', value },
    );
  });

  const condition = any(disjuncts);
  const [first] = sort;
  const bound = first && sort.length > 1 ? leadingBound(first, values[first.field]) : null;
  return bound ? { type: 'and', conditions: [bound, condition] } : condition;
}

/**
 * A redundant range on the first sort field (`a >= x`, or `a <= x` descending), ANDed in front of
 * the expansion. Databases can't use an OR of ANDs as an index range, so without it they walk the
 * index from the start and filter, which is as slow as OFFSET. Added only when every matching row
 * satisfies it: the cursor value is non-null and no nulls can sort after it.
 */
function leadingBound(s: ResolvedSortField, value: unknown): KeysetCondition | null {
  if (value === null || (s.nullable && s.nulls === 'last')) return null;
  return {
    type: 'compare',
    field: s.field,
    operator: s.direction === 'asc' ? 'gte' : 'lte',
    value,
  };
}

/**
 * Rows whose value for this one field comes strictly after `value`, or `null` if none can.
 * Non-nullable fields (the tie-breaker, or declared `nullable: false`) never get an IS NULL
 * branch, which keeps their comparisons index-friendly.
 */
function strictlyAfter(s: ResolvedSortField, value: unknown): KeysetCondition | null {
  if (value === null) {
    // Nothing sorts after a trailing null; every non-null value sorts after a leading null.
    return s.nulls === 'first' ? { type: 'null', field: s.field, isNull: false } : null;
  }
  const compare: KeysetCondition = {
    type: 'compare',
    field: s.field,
    operator: s.direction === 'asc' ? 'gt' : 'lt',
    value,
  };
  return s.nullable && s.nulls === 'last'
    ? any([compare, { type: 'null', field: s.field, isNull: true }])
    : compare;
}

/** @internal A null where the sort spec promises none: the tie-breaker or `nullable: false`. */
export function nullInNonNullable(field: string): TypeError {
  return new TypeError(
    `keyset-kit: "${field}" is null or missing, but it is the last sort field or declared ` +
      'nullable: false. Select it; end the sort with a unique field such as id; only mark NOT NULL columns.',
  );
}

function all(conditions: KeysetCondition[]): KeysetCondition {
  return conditions.length === 1 && conditions[0] ? conditions[0] : { type: 'and', conditions };
}

function any(conditions: KeysetCondition[]): KeysetCondition {
  return conditions.length === 1 && conditions[0] ? conditions[0] : { type: 'or', conditions };
}
