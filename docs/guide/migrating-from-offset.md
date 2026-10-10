# Migrating from OFFSET pagination

## 1. Pick a total order

Start from the order your endpoint already uses and append a unique column:

```ts
// before: ORDER BY created_at DESC  (ties make the order unstable)
// after:
const sort = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
] as const;
```

## 2. Add a matching index

```sql
CREATE INDEX CONCURRENTLY post_created_at_id_idx ON post (created_at DESC, id);
```

Check the plan with `EXPLAIN ANALYZE`: you want an index scan that stops after `limit + 1` rows,
not a sort over the whole table.

## 3. Change the API contract

| OFFSET                   | Keyset                                              |
| ------------------------ | --------------------------------------------------- |
| `?page=3&pageSize=20`    | `?limit=20&after=<endCursor>`                       |
| `{ items, total, page }` | `{ data, pageInfo: { hasNextPage, endCursor, … } }` |
| "Go to page 7"           | Next / previous only                                |

To avoid breaking clients, keep the old parameters working for a while: if `page` is present, run
the old query; otherwise use the cursor path. Return `pageInfo` (and optionally a `Link` header) on
both, then deprecate `page`.

## 4. Replace the query

```ts
// before
const items = await prisma.post.findMany({
  orderBy: { createdAt: 'desc' },
  skip: (page - 1) * pageSize,
  take: pageSize,
});

// after
const page = await paginatePrisma(prisma.post, {}, { sort, limit: pageSize, after });
```

## 5. Update clients

Clients store `pageInfo.endCursor` and send it back as `after`. Treat cursors as opaque strings:
don't parse them, and expect a 400 if a stored one is no longer valid (for example after a sort
change or a secret rotation). Then restart from the first page.

## What about totals?

Keyset pagination never needs `COUNT(*)`. If the UI shows "1,234 results", run the count
separately, ideally cached or estimated, since counting large tables is slow.
