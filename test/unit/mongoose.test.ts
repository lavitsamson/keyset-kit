import { describe, expect, it } from 'vitest';
import type { SortField } from '../../src/index.js';
import { assertProjected, toMongoFilter, withMongoNullOrder } from '../../src/mongoose/index.js';

type Row = Record<string, unknown>;

describe('toMongoFilter', () => {
  it('maps every AST node to MongoDB query operators', () => {
    expect(
      toMongoFilter({
        type: 'or',
        conditions: [
          { type: 'compare', field: 'a', operator: 'gt', value: 1 },
          { type: 'compare', field: 'a', operator: 'lt', value: 2 },
          {
            type: 'and',
            conditions: [
              { type: 'compare', field: 'a', operator: 'eq', value: 3 },
              { type: 'null', field: 'b', isNull: true },
              { type: 'null', field: 'c', isNull: false },
            ],
          },
        ],
      }),
    ).toEqual({
      $or: [
        { a: { $gt: 1 } },
        { a: { $lt: 2 } },
        { $and: [{ a: { $eq: 3 } }, { b: null }, { c: { $ne: null } }] },
      ],
    });
  });
});

describe('withMongoNullOrder', () => {
  it("fills in MongoDB's fixed null order (first ascending, last descending)", () => {
    expect(
      withMongoNullOrder<Row>([
        { field: 'a', direction: 'asc' },
        { field: 'b', direction: 'desc' },
        { field: 'id', direction: 'asc', nulls: 'first' },
      ]),
    ).toEqual([
      { field: 'a', direction: 'asc', nulls: 'first' },
      { field: 'b', direction: 'desc', nulls: 'last' },
      { field: 'id', direction: 'asc', nulls: 'first' },
    ]);
  });

  it('rejects a nulls option MongoDB cannot honour, naming the field', () => {
    expect(() =>
      withMongoNullOrder<Row>([{ field: 'a', direction: 'desc', nulls: 'first' }]),
    ).toThrow(/sorts nulls last for 'desc', but "a" asks for nulls 'first'/);
  });

  it('validates the sort spec first', () => {
    expect(() => withMongoNullOrder<Row>([] as SortField<Row>[])).toThrow(/non-empty array/);
  });
});

describe('assertProjected', () => {
  const check = (projection: unknown) => () => {
    assertProjected(projection, ['a', '_id']);
  };

  it('accepts no projection, inclusive projections with every field, and unrelated exclusions', () => {
    expect(check(null)).not.toThrow();
    expect(check(undefined)).not.toThrow();
    expect(check({ a: 1, b: true })).not.toThrow(); // _id is included by default
    expect(check({ b: 0 })).not.toThrow();
    expect(check({ _id: 1, a: 1 })).not.toThrow();
  });

  it('rejects projections that leave out a sort field', () => {
    expect(check({ b: 1 })).toThrow(/sort field "a" is excluded by the query projection/);
    expect(check({ a: 0 })).toThrow(/"a" is excluded/);
    expect(check({ a: false })).toThrow(/"a" is excluded/);
    expect(check({ a: 1, _id: 0 })).toThrow(/"_id" is excluded/);
  });
});
