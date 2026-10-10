# ADR 0002: Cursor format, signing and ordering semantics

- Status: Accepted
- Date: 2026-10-10

## Context

A keyset cursor carries the sort-key values of a boundary row. It has to survive a round trip
through a URL, keep its value types (Dates, bigints, decimals), resist tampering when the caller
asks for it, and be rejected if it is reused under a different sort order. The condition built from
it must give a total, gap-free order even with duplicate values and nulls.

## Decisions

### Encoding

`base64url(JSON.stringify([version, sortHash | null, { field: value }]))`.

- **Version** (`1`) leaves room to change the layout later without misreading old cursors.
- **Values are tagged** when JSON can't represent them: `["d", iso]` Date, `["b", "123"]`
  bigint, `["n", "12.50"]` decimal (Prisma `Decimal`, BSON `Decimal128`), `["o", hex]`
  ObjectId. Raw cursor values are always scalars, so any array is a tag and can't be confused
  with real data. Dates and bigints decode to their real types. Decimals and ObjectIds decode to
  strings, because the core can't depend on their libraries; Prisma, TypeORM and Mongoose all
  cast strings in filters.
- **Keys are stored with the values** (`{ field: value }` instead of a positional tuple) so
  `decodeCursor` can return a record without knowing the sort. The cost is a few bytes per cursor.
- **Hostile input is bounded**: at most 4096 characters, a strict base64url check, a strict shape
  check, and `Object.fromEntries` for the result so a `__proto__` key can't reach the prototype.

### Binding a cursor to a sort order (`SORT_MISMATCH`)

The spec defines `encodeCursor(values, { secret })`. That function can't compute a sort-spec hash
because it never sees the sort. We added one optional option, `sort`, to `CursorOptions`. With it,
only the sort fields are stored and a 32-bit FNV-1a hash of the spec **as declared** (field,
direction, and `nulls` only when set explicitly) is embedded. `decodeCursor(..., { sort })` rejects a different spec with `SORT_MISMATCH`.
`toPage` and the adapters always pass it. The change is additive: existing call shapes still work.

The hash detects mistakes; it isn't a security control. Tamper resistance comes from signing.

The hash deliberately leaves out null placements that a particular database fills in. The first
version hashed the resolved spec, so it baked in PostgreSQL's defaults. The examples' smoke test
then showed that a cursor issued by the Mongoose adapter (MongoDB's null order) failed the Express
middleware's check (PostgreSQL's) with `SORT_MISMATCH` on page 2. Hashing the declared spec makes
a cursor's identity independent of the database. The trade-off is that adding an explicit `nulls`
equal to the default changes the hash, which invalidates outstanding cursors like any other sort change.

`CursorOptions.sort` is typed with the structural `AnySortField` rather than
`SortField<Record<string, unknown>>`. `SortField<T>` is contravariant in `T` (through
`keyof T`), so a `SortField<Post>[]` wouldn't be assignable to the latter. The type tests caught this.

### Signing

When a `secret` is set: `payload + "." + base64url(HMAC-SHA256(secret, payload))`, using
`node:crypto`, compared with `timingSafeEqual`. The signature is verified before the payload is
parsed. Unsigned cursors are rejected while a secret is configured (`TAMPERED_CURSOR`), and signed
cursors are rejected when none is (`INVALID_CURSOR`), which surfaces misconfiguration between
services. We chose `node:crypto` over Web Crypto because `encodeCursor` and `decodeCursor` are
synchronous and Web Crypto's HMAC is async-only. Every adapter targets Node, so the core does too.

### Null ordering

The core needs one concrete null order to build conditions. Fields without a `nulls` option get
the database's default, passed in by the adapter as a `NullOrder`: `largest` (PostgreSQL: last
ascending, first descending) for Prisma and TypeORM, `smallest` for Mongoose. Adapters emit
`NULLS FIRST/LAST` only when the requested order differs from the database default, so the query
and the condition always agree. MongoDB can't change its order, so the Mongoose adapter rejects
`nulls` options that contradict it. The sort you declare is never rewritten (see the hash above).

### Condition shape

`(a > x) OR (a = x AND b > y) OR (a = x AND b = y AND id > z)`, with `<` for descending fields.
Fields that may be null get `IS NULL` / `IS NOT NULL` branches based on the cursor value and the
null placement. The tie-breaker (last field) is non-null by contract, so it never gets an
`IS NULL` branch, which keeps that comparison index-friendly. `before` reverses every field's
direction and null placement, and `toPage` restores the requested order.

### Leading bound (found by the benchmarks)

The first benchmark run showed that with a matching composite index, keyset pagination was no
faster than OFFSET: 124 ms vs 110 ms at page 10,000 of 1,000,000 rows. `EXPLAIN ANALYZE` showed
an index scan with `Rows Removed by Filter: 199980`. PostgreSQL can't use an `OR` of `AND`s as an
index range, so it walked the index from the start and filtered every earlier row, which is exactly
the work keyset pagination exists to avoid.

The condition now ANDs a redundant bound on the first field in front of the expansion:
`a <= x AND ((a < x) OR (a = x AND id < z))` for a descending `a`. The bound becomes the
`Index Cond`, and the same query reads 25 buffers instead of 200,758 (0.1 ms). It's added to the
ORM-agnostic AST, so every adapter gets it, and `KeysetCompareCondition` gained `gte` and `lte`.
Row-value comparison (`(a, id) < (x, z)`) would be tighter in PostgreSQL, but it only works when
every field has the same direction and no nulls are involved, and Prisma can't express it.

The bound is only added when it's exact: the cursor's first value is non-null and nulls sort
before it. When nulls sort after the cursor (an ascending field with PostgreSQL's default
`nulls: 'last'`, or paging backwards through a descending one), the rows after it include
`a IS NULL`. No index range covers `a >= x OR a IS NULL`, and PostgreSQL 18 doesn't simplify that
`IS NULL` away inside an `OR`, even on a `NOT NULL` column. Such queries are correct but filter
through the index, so their cost grows with depth: 13–23 ms for a cursor about 214,000 rows into
the benchmark table, against 0.1 ms with the bound.

### Declaring non-null fields (`nullable: false`)

To remove that `IS NULL` branch, the core has to know that a column can't be null, and a sort spec
didn't say so. `SortField` gained an optional `nullable` (default `true`, which is always correct).
Fields that are non-nullable, meaning the tie-breaker or any field declared `nullable: false`, get
no `IS NULL` branches and always get the leading bound, in both directions. They also emit a plain
`ORDER BY` direction, since null placement is irrelevant for them.

- **TypeORM detects it.** The adapter reads `isNullable` from the entity metadata, but only for the
  query's main alias, because a `LEFT JOIN` can return nulls for a joined entity's `NOT NULL`
  column. A `nullable` the caller sets wins.
- **Prisma and Mongoose can't.** A Prisma delegate exposes no schema through public API, and a
  MongoDB field can be missing even when the Mongoose schema requires it. Callers declare it.
- **Express** copies `nullable` from `defaultSort` onto client-chosen fields, as it does for `nulls`.
  Fields that appear only in `allowedSort` stay nullable. Keeping the spec's `allowedSort: string[]`
  was worth that gap.
- **Wrong declarations fail loudly where they can.** A null in a non-nullable field, whether in a
  cursor or in a fetched row, throws instead of silently skipping rows. Rows that were never
  fetched can't be checked, which the docs state.
- **Not part of the sort hash.** `nullable` doesn't change the order, so cursors stay valid
  whichever way it's declared.

Rejected: assuming non-null by default. It would make the common case fast without any
declaration, but a nullable column would then silently lose its null rows. Defaults must be
correct and fast paths opt-in.

### Tie-breaker validation

Whether a column is unique can't be seen from a sort spec. `toPage` checks what it can: it throws
if any fetched row has a null or missing last field (or a null in a `nullable: false` field), or if
two rows share the last field. This catches the
common mistake (sorting by `createdAt` alone) the first time duplicates appear in a page.

### `pageInfo` without extra queries

The adapters fetch `limit + 1` rows, and the extra row answers `hasNextPage` (forwards) or
`hasPreviousPage` (backwards). The opposite flag reports whether a cursor was supplied, the
approximation the Relay connection spec allows. That avoids a second query.

## Consequences

- Cursors are opaque but readable (base64url JSON). Applications that need tamper resistance set a
  `secret`. The docs recommend it for public APIs.
- Correctness is checked by property-based tests: random datasets with duplicates and nulls and
  random sort specs, walked forwards and backwards, with inserts between requests.
- Query plans are checked by the benchmarks (`bench/`), which run each strategy's exact SQL under
  `EXPLAIN ANALYZE` on 1,000,000 rows.
- The core is 2.99 kB min+gzip against a 3 kB budget. Further core features will need to
  give something up, or the budget will need revisiting. Most of that is actionable error text,
  which we keep on purpose. Adapters are separate entry points and don't count toward it.
