import { describe, expect, it } from 'vitest';
import { buildKeysetCondition, type KeysetCondition, type SortField } from '../../src/index.js';

type Row = Record<string, unknown>;

const gt = (field: string, value: unknown): KeysetCondition => ({
  type: 'compare',
  field,
  operator: 'gt',
  value,
});
const lt = (field: string, value: unknown): KeysetCondition => ({
  type: 'compare',
  field,
  operator: 'lt',
  value,
});
const eq = (field: string, value: unknown): KeysetCondition => ({
  type: 'compare',
  field,
  operator: 'eq',
  value,
});
const isNull = (field: string): KeysetCondition => ({ type: 'null', field, isNull: true });
const notNull = (field: string): KeysetCondition => ({ type: 'null', field, isNull: false });
const and = (...conditions: KeysetCondition[]): KeysetCondition => ({ type: 'and', conditions });
const or = (...conditions: KeysetCondition[]): KeysetCondition => ({ type: 'or', conditions });

describe('buildKeysetCondition', () => {
  it('expands a multi-column sort into the canonical OR-of-ANDs', () => {
    const sort: SortField<Row>[] = [
      { field: 'a', direction: 'asc', nulls: 'first' },
      { field: 'b', direction: 'asc', nulls: 'first' },
      { field: 'id', direction: 'asc' },
    ];
    // (a > x) OR (a = x AND b > y) OR (a = x AND b = y AND id > z)
    expect(buildKeysetCondition(sort, { a: 'x', b: 'y', id: 'z' }, 'after')).toEqual(
      or(
        gt('a', 'x'),
        and(eq('a', 'x'), gt('b', 'y')),
        and(eq('a', 'x'), eq('b', 'y'), gt('id', 'z')),
      ),
    );
  });

  it('uses < for descending fields', () => {
    const sort: SortField<Row>[] = [
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'desc' },
    ];
    const at = new Date('2026-01-01T00:00:00Z');
    // desc defaults to nulls first, so a non-null cursor needs no IS NULL branch.
    expect(buildKeysetCondition(sort, { createdAt: at, id: 9 }, 'after')).toEqual(
      or(lt('createdAt', at), and(eq('createdAt', at), lt('id', 9))),
    );
  });

  it('returns a bare comparison for a single-field sort', () => {
    expect(buildKeysetCondition([{ field: 'id', direction: 'asc' }], { id: 3 }, 'after')).toEqual(
      gt('id', 3),
    );
  });

  it('reverses every field for "before"', () => {
    const sort: SortField<Row>[] = [
      { field: 'a', direction: 'asc', nulls: 'first' },
      { field: 'id', direction: 'asc' },
    ];
    // Reversed: a desc nulls last, so rows before the cursor include NULL a.
    expect(buildKeysetCondition(sort, { a: 5, id: 2 }, 'before')).toEqual(
      or(or(lt('a', 5), isNull('a')), and(eq('a', 5), lt('id', 2))),
    );
  });

  describe('nulls', () => {
    it('includes NULL rows after a non-null cursor when nulls sort last', () => {
      const sort: SortField<Row>[] = [
        { field: 'a', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ];
      expect(buildKeysetCondition(sort, { a: 5, id: 1 }, 'after')).toEqual(
        or(or(gt('a', 5), isNull('a')), and(eq('a', 5), gt('id', 1))),
      );
    });

    it('matches every non-null row after a null cursor when nulls sort first', () => {
      const sort: SortField<Row>[] = [
        { field: 'a', direction: 'asc', nulls: 'first' },
        { field: 'id', direction: 'asc' },
      ];
      expect(buildKeysetCondition(sort, { a: null, id: 1 }, 'after')).toEqual(
        or(notNull('a'), and(isNull('a'), gt('id', 1))),
      );
    });

    it('only ties on NULL after a null cursor when nulls sort last', () => {
      const sort: SortField<Row>[] = [
        { field: 'a', direction: 'asc', nulls: 'last' },
        { field: 'id', direction: 'asc' },
      ];
      expect(buildKeysetCondition(sort, { a: null, id: 1 }, 'after')).toEqual(
        and(isNull('a'), gt('id', 1)),
      );
    });

    it('never adds an IS NULL branch for the tie-breaker', () => {
      expect(
        buildKeysetCondition(
          [{ field: 'id', direction: 'asc', nulls: 'last' }],
          { id: 1 },
          'after',
        ),
      ).toEqual(gt('id', 1));
    });
  });

  it('rejects cursor values missing a sort field', () => {
    const sort: SortField<Row>[] = [
      { field: 'a', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];
    expect(() => buildKeysetCondition(sort, { id: 1 }, 'after')).toThrow(/missing sort field "a"/);
    expect(() => buildKeysetCondition(sort, { a: undefined, id: 1 }, 'after')).toThrow(
      /missing sort field "a"/,
    );
  });

  it('rejects a null tie-breaker value', () => {
    expect(() =>
      buildKeysetCondition([{ field: 'id', direction: 'asc' }], { id: null }, 'after'),
    ).toThrow(/last sort field "id" is null/);
  });
});
