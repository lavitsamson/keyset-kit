# Why keyset pagination

## The problem with OFFSET

`LIMIT 20 OFFSET 10000` asks the database for rows 10,001 to 10,020. To find them it still reads
and discards the first 10,000 rows, so every page is slower than the one before. Deep pages in a
large table take seconds.

OFFSET is also **wrong while data changes**. If a row is inserted on page 1 while a user reads it,
every later row shifts down by one: the user sees the last row of page 1 again at the top of
page 2. A deleted row shifts everything up, and one row is never shown.

## Continue from the last row instead

Keyset pagination (also called seek or cursor pagination) remembers the sort values of the last row
on the page and asks for rows **after** them:

```sql
SELECT * FROM post
WHERE (created_at, id) < ($1, $2)   -- the last row of the previous page
ORDER BY created_at DESC, id DESC
LIMIT 21;                            -- one extra row: is there a next page?
```

With an index on `(created_at, id)` the database jumps straight to the right place and reads only
21 rows, on page 1 and on page 10,000. Inserted and deleted rows can't shift a page, because the
position is a value, not a count. The [benchmarks](https://github.com/lavitsamson/keyset-kit/blob/main/bench/RESULTS.md)
measure both strategies on a 1,000,000-row PostgreSQL table, with the query plans.

![OFFSET reads and discards every earlier row; keyset seeks to the cursor through the index and reads only the page.](/offset-vs-keyset.svg)

## What makes it fiddly, and what keyset-kit handles

| Problem                                  | keyset-kit                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Multi-column sorts with mixed directions | Expands `(a, b, id)` into the correct `OR`/`AND` condition per field direction. |
| Duplicate values in the sort column      | Requires a unique tie-breaker and detects when it isn't unique.                 |
| `NULL` values                            | Explicit null ordering per field; IS NULL branches built for you.               |
| Going backwards                          | `before` reverses the query and restores the order in the result.               |
| Knowing if there is a next page          | Fetches `limit + 1` rows; no `COUNT(*)`.                                        |
| Cursor types (Dates, bigints, decimals)  | Typed encoding that round-trips exactly.                                        |
| Clients tampering with cursors           | Optional HMAC-SHA256 signing; cursors bound to their sort order.                |

## Trade-offs

- **No "jump to page 37".** Pages are reached by walking from a cursor. Most feeds, tables with
  "next/previous" and infinite scroll don't need random access.
- **No total count for free.** Run a separate `COUNT(*)` if your UI needs it (and consider caching it).
- **Index the sort.** Keyset pagination is fast because of the index on the sort columns. See
  [Migrating from OFFSET](./migrating-from-offset).
