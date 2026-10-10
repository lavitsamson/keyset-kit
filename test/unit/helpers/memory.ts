// In-memory "database" that executes keyset queries the way an adapter would:
// filter by the KeysetCondition, order by the prepared sort, take limit + 1, then toPage.
import { preparePagination, toPage } from '../../../src/core/page.js';
import type { ResolvedSortField } from '../../../src/core/sort.js';
import type { KeysetCondition, Page, PaginateOptions } from '../../../src/index.js';

type Comparable = number | string | bigint | boolean;

function comparable(value: unknown): Comparable {
  if (value instanceof Date) return value.getTime();
  return value as Comparable;
}

function compareValues(a: unknown, b: unknown): number {
  const x = comparable(a);
  const y = comparable(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function field(row: object, name: string): unknown {
  return (row as Record<string, unknown>)[name];
}

/** SQL semantics: comparisons never match NULL. */
export function evaluate(condition: KeysetCondition, row: object): boolean {
  switch (condition.type) {
    case 'and':
      return condition.conditions.every((c) => evaluate(c, row));
    case 'or':
      return condition.conditions.some((c) => evaluate(c, row));
    case 'null':
      return (field(row, condition.field) === null) === condition.isNull;
    case 'compare': {
      const value = field(row, condition.field);
      if (value === null) return false;
      const result = compareValues(value, condition.value);
      switch (condition.operator) {
        case 'eq':
          return result === 0;
        case 'gt':
          return result > 0;
        case 'gte':
          return result >= 0;
        case 'lt':
          return result < 0;
        case 'lte':
          return result <= 0;
      }
    }
  }
}

export function compareRows(sort: readonly ResolvedSortField[]) {
  return (a: object, b: object): number => {
    for (const s of sort) {
      const av = field(a, s.field);
      const bv = field(b, s.field);
      if (av === null && bv === null) continue;
      if (av === null) return s.nulls === 'first' ? -1 : 1;
      if (bv === null) return s.nulls === 'first' ? 1 : -1;
      const result = compareValues(av, bv);
      if (result !== 0) return s.direction === 'asc' ? result : -result;
    }
    return 0;
  };
}

export function paginateMemory<T extends object>(
  rows: readonly T[],
  options: PaginateOptions<T>,
): Page<T> {
  const prepared = preparePagination(options);
  const result = rows
    .filter((row) => prepared.where === null || evaluate(prepared.where, row))
    .sort(compareRows(prepared.sort))
    .slice(0, prepared.take);
  return toPage(result, options);
}
