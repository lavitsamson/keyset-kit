import { describe, expect, it } from 'vitest';
import { buildKeysetCondition, type SortField } from '../../src/index.js';
import { toTypeormWhere } from '../../src/typeorm/index.js';

type Row = Record<string, unknown>;
const column = (field: string): string => `item.${field}`;

describe('toTypeormWhere', () => {
  it('renders comparisons with named parameters, fully parenthesised', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const sort: SortField<Row>[] = [
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ];
    const parameters: Record<string, unknown> = {};
    const sql = toTypeormWhere(
      buildKeysetCondition(sort, { createdAt: at, id: 5 }, 'after'),
      column,
      parameters,
    );

    expect(sql).toBe(
      '(item.createdAt <= :keyset_kit_0) AND ' +
        '((item.createdAt < :keyset_kit_1) OR ' +
        '((item.createdAt = :keyset_kit_2) AND (item.id > :keyset_kit_3)))',
    );
    expect(parameters).toEqual({
      keyset_kit_0: at,
      keyset_kit_1: at,
      keyset_kit_2: at,
      keyset_kit_3: 5,
    });
  });

  it('renders IS NULL and IS NOT NULL without parameters', () => {
    const parameters: Record<string, unknown> = {};
    const sql = toTypeormWhere(
      {
        type: 'or',
        conditions: [
          { type: 'null', field: 'a', isNull: false },
          { type: 'null', field: 'a', isNull: true },
        ],
      },
      column,
      parameters,
    );
    expect(sql).toBe('(item.a IS NOT NULL) OR (item.a IS NULL)');
    expect(parameters).toEqual({});
  });

  it('never puts values into the SQL text', () => {
    const parameters: Record<string, unknown> = {};
    const sql = toTypeormWhere(
      { type: 'compare', field: 'b', operator: 'eq', value: "x'; DROP TABLE item; --" },
      column,
      parameters,
    );
    expect(sql).toBe('item.b = :keyset_kit_0');
    expect(parameters['keyset_kit_0']).toBe("x'; DROP TABLE item; --");
  });
});
