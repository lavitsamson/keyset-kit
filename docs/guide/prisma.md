# Prisma

```ts
import { paginatePrisma } from 'keyset-kit/prisma';

const page = await paginatePrisma(
  prisma.post, // any model delegate
  { where: { published: true }, select: { id: true, title: true, createdAt: true } },
  {
    sort: [
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
    limit: 20,
    after: req.query.after,
    secret: process.env.CURSOR_SECRET,
  },
);
```

## Arguments

1. **`delegate`**: a model delegate such as `prisma.post`. The row type is inferred from it, so sort
   fields are checked against your model.
2. **`args`**: `{ where?, select?, include? }`. Your `where` is combined with the keyset condition
   using `AND`. `orderBy`, `take` and `cursor` are set by the paginator.
3. **`options`**: [`PaginateOptions`](/api/index.html), or `req.keyset` from the
   [Express middleware](./express).

## Things to know

- **Select every sort field.** With `select`, include each sort field (here `createdAt` and `id`).
  If one is missing, you get an error that names it.
- **PostgreSQL is the tested database.** Null ordering follows PostgreSQL's defaults; the adapter
  only emits `{ sort, nulls }` in `orderBy` when you ask for a non-default order. Prisma accepts
  `nulls` only on optional fields, so don't set it on required ones.
- **Index the sort**: `@@index([createdAt(sort: Desc), id])` lets PostgreSQL serve each page with
  an index range scan.
- **Mark required sort fields** with `nullable: false`. The adapter can't see your schema, so
  otherwise it assumes nulls are possible, and ascending sorts and backwards pages then can't use
  the index as a range. See [Sorting & nulls](./sorting-and-nulls#indexes).
- **`DateTime` is safe.** Prisma maps it to `timestamp(3)`, the same millisecond precision as the
  JavaScript `Date` in the cursor.
- **Decimals** in cursors come back as strings, which Prisma accepts in filters.

See `examples/express-prisma` for a complete app.
