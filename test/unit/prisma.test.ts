import { describe, expect, it, vi } from 'vitest';
import { encodeCursor, InvalidCursorError, type SortField } from '../../src/index.js';
import { paginatePrisma, toPrismaOrderBy, toPrismaWhere } from '../../src/prisma/index.js';

interface Post {
  id: number;
  createdAt: Date;
  title: string;
}

const sort: SortField<Post>[] = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];

/** A fake delegate that records the query and returns the given rows. */
function fakeDelegate(rows: Post[]) {
  const findMany = vi.fn<(args: unknown) => Promise<Post[]>>(() => Promise.resolve(rows));
  return { delegate: { findMany }, findMany };
}

describe('toPrismaWhere', () => {
  it('maps every AST node to Prisma filter syntax', () => {
    expect(
      toPrismaWhere({
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
      OR: [
        { a: { gt: 1 } },
        { a: { lt: 2 } },
        { AND: [{ a: { equals: 3 } }, { b: null }, { c: { not: null } }] },
      ],
    });
  });
});

describe('toPrismaOrderBy', () => {
  it('emits plain directions when nulls match the PostgreSQL default', () => {
    expect(
      toPrismaOrderBy([
        { field: 'a', direction: 'asc', nulls: 'last', explicitNulls: false },
        { field: 'b', direction: 'desc', nulls: 'first', explicitNulls: false },
      ]),
    ).toEqual([{ a: 'asc' }, { b: 'desc' }]);
  });

  it('emits { sort, nulls } when the null placement is not the default', () => {
    expect(
      toPrismaOrderBy([
        { field: 'a', direction: 'asc', nulls: 'first', explicitNulls: false },
        { field: 'b', direction: 'desc', nulls: 'last', explicitNulls: false },
      ]),
    ).toEqual([{ a: { sort: 'asc', nulls: 'first' } }, { b: { sort: 'desc', nulls: 'last' } }]);
  });
});

describe('paginatePrisma', () => {
  const rows: Post[] = [1, 2, 3].map((id) => ({
    id,
    createdAt: new Date(Date.UTC(2026, 0, 10 - id)),
    title: `post ${String(id)}`,
  }));

  it('fetches limit + 1 rows in sort order on the first page', async () => {
    const { delegate, findMany } = fakeDelegate(rows);
    const page = await paginatePrisma(delegate, {}, { sort, limit: 2 });

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 3,
    });
    expect(page.data.map((p) => p.id)).toEqual([1, 2]);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it('combines the caller filter with the keyset condition and passes select/include through', async () => {
    const { delegate, findMany } = fakeDelegate([]);
    const at = new Date(Date.UTC(2026, 0, 5));
    const after = encodeCursor({ createdAt: at, id: 7 }, { sort });
    const select = { id: true, createdAt: true };
    const include = { author: true };

    await paginatePrisma(
      delegate,
      { where: { title: { contains: 'x' } }, select, include },
      { sort, after },
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { title: { contains: 'x' } },
          {
            OR: [
              { createdAt: { lt: at } },
              { AND: [{ createdAt: { equals: at } }, { id: { gt: 7 } }] },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 21,
      select,
      include,
    });
  });

  it('uses only the caller filter on the first page and only the keyset filter without one', async () => {
    const first = fakeDelegate([]);
    await paginatePrisma(first.delegate, { where: { title: 'x' } }, { sort });
    expect(first.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { title: 'x' } });

    const next = fakeDelegate([]);
    await paginatePrisma(
      next.delegate,
      {},
      { sort, after: encodeCursor({ createdAt: new Date(0), id: 1 }, { sort }) },
    );
    expect(next.findMany.mock.calls[0]?.[0]).toHaveProperty('where.OR');
  });

  it('reverses the order for "before" and restores it in the result', async () => {
    const { delegate, findMany } = fakeDelegate([...rows].reverse());
    const before = encodeCursor({ createdAt: new Date(0), id: 99 }, { sort });
    const page = await paginatePrisma(delegate, {}, { sort, limit: 2, before });

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ createdAt: 'asc' }, { id: 'desc' }],
    });
    // The two rows immediately before the cursor, back in requested (createdAt desc) order.
    expect(page.data.map((p) => p.id)).toEqual([2, 3]);
  });

  it('calls findMany with the delegate as `this` (Prisma delegates are not bound)', async () => {
    const delegate = {
      rows,
      findMany(this: { rows: Post[] }) {
        return Promise.resolve(this.rows);
      },
    };
    await expect(paginatePrisma(delegate, {}, { sort })).resolves.toHaveProperty('data.length', 3);
  });

  it('rejects an invalid cursor before querying', async () => {
    const { delegate, findMany } = fakeDelegate([]);
    await expect(
      paginatePrisma(delegate, {}, { sort, after: 'not-a-cursor!' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(findMany).not.toHaveBeenCalled();
  });
});
