import { assertType, describe, expectTypeOf, it } from 'vitest';
import {
  buildKeysetCondition,
  decodeCursor,
  encodeCursor,
  toPage,
  type InvalidCursorCode,
  type KeysetCondition,
  type Page,
  type PaginateOptions,
  type SortField,
} from '../../src/index.js';

interface Post {
  id: number;
  title: string;
  createdAt: Date;
}

const sort: SortField<Post>[] = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];

describe('public types', () => {
  it('infers sortable field names from the model type', () => {
    expectTypeOf<SortField<Post>['field']>().toEqualTypeOf<'id' | 'title' | 'createdAt'>();
  });

  it('rejects fields that do not exist on the model', () => {
    // @ts-expect-error - 'nope' is not a field of Post
    assertType<SortField<Post>>({ field: 'nope', direction: 'asc' });
  });

  it('accepts explicit undefined for optional options (env vars, optional query params)', () => {
    const secret: string | undefined = process.env['CURSOR_SECRET'];
    const after: string | undefined = undefined;
    assertType<PaginateOptions<Post>>({ sort, limit: undefined, after, secret });
    assertType<Parameters<typeof encodeCursor>[1]>({ secret, sort: undefined });
  });

  it('still rejects wrongly typed options', () => {
    // @ts-expect-error - limit must be a number
    assertType<PaginateOptions<Post>>({ sort, limit: '20' });
  });

  it('accepts a readonly (as const) sort spec', () => {
    const constSort = [{ field: 'id', direction: 'asc' }] as const;
    assertType<PaginateOptions<Post>>({ sort: constSort });
  });

  it('exposes the three error codes', () => {
    expectTypeOf<InvalidCursorCode>().toEqualTypeOf<
      'INVALID_CURSOR' | 'TAMPERED_CURSOR' | 'SORT_MISMATCH'
    >();
  });

  it('toPage preserves the row type', () => {
    const rows: Post[] = [];
    expectTypeOf(toPage(rows, { sort })).toEqualTypeOf<Page<Post>>();
    // @ts-expect-error - sort fields are checked against the row type
    toPage(rows, { sort: [{ field: 'missing', direction: 'asc' }] });
  });

  it('buildKeysetCondition checks fields against the model and returns the AST type', () => {
    expectTypeOf(buildKeysetCondition<Post>(sort, {}, 'after')).toEqualTypeOf<KeysetCondition>();
    // @ts-expect-error - 'missing' is not a field of Post
    buildKeysetCondition<Post>([{ field: 'missing', direction: 'asc' }], {}, 'after');
    // @ts-expect-error - direction must be 'after' or 'before'
    buildKeysetCondition<Post>(sort, {}, 'forward');
  });

  it('cursor functions accept a model-typed sort spec', () => {
    expectTypeOf(encodeCursor({ id: 1 }, { sort, secret: 's' })).toEqualTypeOf<string>();
    expectTypeOf(decodeCursor('c', { sort })).toEqualTypeOf<Record<string, unknown>>();
  });
});
