import { assertType, describe, expectTypeOf, it } from 'vitest';
import type { InvalidCursorCode, PaginateOptions, SortField } from '../../src/index.js';

interface Post {
  id: number;
  title: string;
  createdAt: Date;
}

describe('public types', () => {
  it('infers sortable field names from the model type', () => {
    expectTypeOf<SortField<Post>['field']>().toEqualTypeOf<'id' | 'title' | 'createdAt'>();
  });

  it('rejects fields that do not exist on the model', () => {
    // @ts-expect-error - 'nope' is not a field of Post
    assertType<SortField<Post>>({ field: 'nope', direction: 'asc' });
  });

  it('does not accept explicit undefined for optional options (exactOptionalPropertyTypes)', () => {
    // @ts-expect-error - limit must be omitted, not undefined
    assertType<PaginateOptions<Post>>({
      sort: [{ field: 'id', direction: 'asc' }],
      limit: undefined,
    });
  });

  it('exposes the three error codes', () => {
    expectTypeOf<InvalidCursorCode>().toEqualTypeOf<
      'INVALID_CURSOR' | 'TAMPERED_CURSOR' | 'SORT_MISMATCH'
    >();
  });
});
