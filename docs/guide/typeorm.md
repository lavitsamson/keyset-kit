# TypeORM

```ts
import { paginateQueryBuilder } from 'keyset-kit/typeorm';

const qb = dataSource
  .getRepository(Post)
  .createQueryBuilder('post')
  .leftJoinAndSelect('post.tags', 'tag')
  .where('post.published = :published', { published: true });

const page = await paginateQueryBuilder(qb, 'post', {
  sort: [
    { field: 'createdAt', direction: 'desc' },
    { field: 'id', direction: 'asc' },
  ],
  after: req.query.after,
});
```

## Arguments

1. **`qb`**: a `SelectQueryBuilder`. It is cloned, never modified, so you can reuse it.
2. **`alias`**: the alias you passed to `createQueryBuilder()`. Sort fields are properties of that
   entity.
3. **`options`**: [`PaginateOptions`](/api/index.html), or `req.keyset`.

## What the adapter takes care of

- **Your `WHERE` keeps its meaning.** TypeORM would render `where(a).orWhere(b)` plus another
  condition as `a OR (b AND …)`. The adapter wraps your existing conditions in parentheses before
  adding the keyset condition.
- **Joins paginate by entity.** The adapter uses `take`, not `LIMIT`, so a one-to-many join returns
  `limit` entities with all their related rows.
- **Column names are mapped.** Use property names (`createdAt`); TypeORM resolves them to columns
  (`created_at`).
- **Field names are validated.** Each sort field must be a column of the entity, so a field name
  from user input never reaches the SQL. Values are always passed as parameters.
- Your `ORDER BY` is replaced by the sort you pass.
- **`NOT NULL` columns are detected.** Sort fields on non-nullable columns of the main entity are
  treated as `nullable: false`, so pages stay index range scans in both directions and for
  ascending sorts. Fields of joined aliases are left nullable, since a `LEFT JOIN` can produce
  nulls. A `nullable` you set yourself wins.

## Things to know

- Use `timestamp(3)` (`precision: 3`) for timestamp sort columns in PostgreSQL. The default
  microsecond precision is finer than a JavaScript `Date`, which can skip or repeat rows.
- `bigint` and `numeric` columns come back from TypeORM as strings; they work in cursors as-is.

See `examples/nestjs-typeorm` for a NestJS app.
