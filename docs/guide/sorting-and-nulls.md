# Sorting & nulls

## Sort specs

A sort is a list of fields, each with a direction, an optional null placement, and optionally
`nullable: false` for columns that can't be null (see [Indexes](#indexes)):

```ts
const sort: SortField<Post>[] = [
  { field: 'score', direction: 'desc', nulls: 'last' },
  { field: 'createdAt', direction: 'desc', nullable: false },
  { field: 'id', direction: 'asc' }, // unique tie-breaker, always last
];
```

Field names are checked against the model type. The sort must end with a unique, non-null field.
If a page contains two rows with the same value in that field, or a null one, `toPage` throws and
explains how to fix the sort.

## How the condition is built

For `a asc, b desc, id asc` and a cursor `(x, y, z)`, the rows after the cursor are:

```text
(a > x)
OR (a = x AND b < y)
OR (a = x AND b = y AND id > z)
```

Descending fields use `<`. For `before`, every field's direction and null placement is reversed,
the query fetches rows in that reversed order, and the page is flipped back before it's returned.

When no nulls can follow the cursor in the first field, a redundant bound on that field is ANDed
in front: `a >= x AND (...)` here, or `a <= x` for a descending field. It doesn't change the result.
It lets the database use an index: PostgreSQL can't turn an `OR` into an index range, so without
the bound it walks the index from the beginning and filters, which is as slow as OFFSET.

## Null ordering

| Database   | Default (no `nulls` option)                    | Can you change it?              |
| ---------- | ---------------------------------------------- | ------------------------------- |
| PostgreSQL | nulls **last** ascending, **first** descending | Yes: `nulls: 'first' \| 'last'` |
| MongoDB    | nulls **first** ascending, **last** descending | No: contradicting options throw |

With nullable sort fields, `keyset-kit` adds the right `IS NULL` / `IS NOT NULL` branches. For
example, after a cursor whose `score` is `5` with nulls sorted last ascending, the rows after it
are `score > 5 OR score IS NULL`. The tie-breaker and fields declared `nullable: false` never get
such a branch, which keeps their comparisons index-friendly (see [Indexes](#indexes)).

In MongoDB, a **missing** field sorts like `null`, and cursors treat it the same way.

## Precision and types

- **Timestamps**: cursors carry JavaScript `Date`s with millisecond precision. In PostgreSQL use
  `timestamp(3)` / `timestamptz(3)` (Prisma's `DateTime` default). With microsecond columns, rows
  that differ by less than a millisecond compare as equal to the cursor and can be skipped or repeated.
- **bigint, decimal, ObjectId** values survive the round trip. Bigints come back as `bigint`;
  decimals and ObjectIds as strings, which all three ORMs accept in filters.
- **Strings** sort by the database collation. Rows are compared in the database, so whatever
  collation the column uses is applied consistently.

## Indexes

Create one index that matches the default sort, column order and directions included:

```sql
CREATE INDEX post_created_at_id_idx ON post (created_at DESC, id);
```

Each page is then an index range scan that reads about `limit + 1` rows, whatever the page depth,
as long as no nulls can follow the cursor in the first sort field.

### Declare columns that can't be null

If nulls can follow the cursor, the condition needs a `first_field IS NULL` branch, and no single
index range covers `a >= x OR a IS NULL`. PostgreSQL then filters through the index from the start,
and the cost grows with depth. With PostgreSQL's default null order that happens for an ascending
first field, and when paging **backwards** through a descending one. It happens even on a
`NOT NULL` column, because the planner doesn't drop an `IS NULL` inside an `OR`.

Tell `keyset-kit` which sort fields can't be null, and those branches go away:

```ts
const sort: SortField<Post>[] = [
  { field: 'createdAt', direction: 'asc', nullable: false }, // NOT NULL column
  { field: 'id', direction: 'asc' }, // the tie-breaker is always treated as non-null
];
```

- **TypeORM** does this for you: sort fields on `NOT NULL` columns of the main entity are detected
  from the entity metadata.
- **Prisma, Mongoose and `toPage`** can't see the schema, so set `nullable: false` yourself.
- **Express**: set it in `defaultSort`; it also applies when a client sorts by that field.

Only mark columns that really can't be null. If a fetched row or a cursor has a null in such a
field, `keyset-kit` throws instead of silently skipping rows, but rows it never fetched can't be
checked. `nullable` doesn't change the order, so it isn't part of the cursor's sort hash.

Check deep pages with `EXPLAIN ANALYZE`: look for `Index Cond` on the first sort column.
