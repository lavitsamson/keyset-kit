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
only the sort fields are stored and a 32-bit FNV-1a hash of the resolved spec (field, direction,
nulls) is embedded. `decodeCursor(..., { sort })` rejects a different spec with `SORT_MISMATCH`.
`toPage` and the adapters always pass it. The change is additive: existing call shapes still work.

The hash detects mistakes; it isn't a security control. Tamper resistance comes from signing.

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

The core needs one concrete null order to build conditions. The default is PostgreSQL's: nulls
count as larger than any value, so they come last ascending and first descending. Adapters emit
explicit `NULLS FIRST/LAST` so the database matches the condition exactly. MongoDB can't change
its order (nulls are smallest), so the Mongoose adapter will pass that order explicitly.

### Condition shape

`(a > x) OR (a = x AND b > y) OR (a = x AND b = y AND id > z)`, with `<` for descending fields.
Fields that may be null get `IS NULL` / `IS NOT NULL` branches based on the cursor value and the
null placement. The tie-breaker (last field) is non-null by contract, so it never gets an
`IS NULL` branch, which keeps that comparison index-friendly. `before` reverses every field's
direction and null placement, and `toPage` restores the requested order.

### Tie-breaker validation

Whether a column is unique can't be seen from a sort spec. `toPage` checks what it can: it throws
if any fetched row has a null or missing last field, or if two rows share it. This catches the
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
- The core is 2.86 kB min+gzip against a 3 kB budget. Most of that is actionable error text,
  which we keep on purpose. Adapters are separate entry points and don't count toward it.
