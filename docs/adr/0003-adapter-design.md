# ADR 0003: Adapter design and the conformance suite

- Status: Accepted
- Date: 2026-10-10

## Context

Four adapters (Prisma, TypeORM, Mongoose, Express) must behave identically, ship with zero
runtime dependencies, and work with whatever ORM version the user has installed. Bugs in keyset
pagination tend to come from database specifics (null ordering, timestamp precision, numeric
types), so unit tests with fakes aren't enough on their own.

## Decisions

### One shared pipeline

Every adapter follows the same steps: `preparePagination(options)` (validate, decode the cursor,
build the condition, orient the sort, compute `take = limit + 1`), translate the condition and
sort into the ORM's syntax, run one query, then `toPage(rows, options)`. Adapters only translate;
the pagination logic exists once, in the core.

### Structural ORM types instead of importing the ORM

`paginatePrisma` accepts any `{ findMany(args): PromiseLike<T[]> }` instead of importing
`@prisma/client`. Prisma generates a different client per schema (and from Prisma 7 into the
user's own source tree), so there's no single type to import. A structural type works with
every generated client, and the row type is still inferred from the delegate. The peer
dependency is declared optional so it documents supported versions without forcing an install.

### Prisma `orderBy`

The adapter emits a plain `'asc' | 'desc'` when a field's null placement matches PostgreSQL's
default for that direction, and `{ sort, nulls }` only when it doesn't. The two are equivalent,
but the plain form also works on required fields (Prisma only accepts `nulls` on optional ones),
and PostgreSQL can serve it with an ordinary B-tree index in both directions.

### TypeORM query builders

- **Clone, never modify.** `paginateQueryBuilder` works on `qb.clone()`, so the caller can reuse
  their builder for the next page.
- **Keep the caller's conditions grouped.** TypeORM renders `where(a).orWhere(b).andWhere(c)` as
  `a OR b AND c`, and a single raw string such as `"a OR b"` is never parenthesised. The adapter
  wraps the existing `WHERE` with TypeORM's `brackets` operator (which always adds parentheses)
  before ANDing the keyset condition.
- **Validate fields against entity metadata.** Sort fields may come from a query string (see the
  Express middleware). Each one must be a real property of the aliased entity before it's
  interpolated as `alias.property`. Values always go in as named parameters.
- **`take`, not `limit`.** With one-to-many joins, `LIMIT` counts joined rows. `take` makes
  TypeORM paginate distinct entities, which an integration test checks.

### Mongoose queries

- **MongoDB's null order is fixed** (null and missing values are smallest). The adapter fills in
  `nulls: 'first'` for ascending and `'last'` for descending fields, so the core builds matching
  conditions, and it rejects a `nulls` option MongoDB can't honour instead of returning wrong pages.
  The conformance suite has a `fixedNullOrder: 'smallest'` mode for this.
- **Missing fields read as null.** MongoDB sorts a missing field like `null`, and `{ field: null }`
  matches both. Cursors therefore treat `undefined` as `null` (through an internal field reader for
  `toPage`). Because that would hide a sort field dropped by `select()`, the adapter checks the
  query projection and rejects one that excludes a sort field.
- **Fields must be schema paths**, which keeps a value like `$where` from becoming an operator.
  The caller's filter and the keyset condition are combined with `$and` on a clone of the query.
  Decoded ObjectIds and Decimal128s arrive as strings, and Mongoose casts them through the schema.

### The conformance suite

`test/integration/conformance.ts` defines the behaviour every adapter must have. Each adapter
supplies a small `ConformanceTarget` (reset, insert, paginate) backed by a real database started
with Testcontainers. The suite runs property-based checks on random data with duplicates and nulls
and random sort specs: forward and backward walks, a caller filter, and inserts between requests.
It also checks exact round trips of millisecond timestamps, bigints above 2^53 and decimals, plus
rejection of bad cursors. The expected order comes from an independent in-memory comparator, not
from the adapter under test.

This suite found a bug the unit tests couldn't. Prisma 7 bundles decimal.js under the minified
class name `Decimal2`, so detecting decimals by constructor name failed. Detection now uses
`Symbol.toStringTag`, which decimal.js sets explicitly.

## Consequences

- A new adapter needs only a translator and a `ConformanceTarget`. Contributors adding Drizzle or
  Sequelize get the whole correctness suite for free.
- Integration tests need Docker locally. CI's Ubuntu runners include it.
- **Timestamp precision matters.** Cursors carry JavaScript `Date`s (millisecond precision). A
  PostgreSQL `timestamp`/`timestamptz` column defaults to microsecond precision, and then
  equality on the cursor value can fail, which skips or repeats rows. Prisma's `DateTime` maps to
  `timestamp(3)` by default, which is safe. Other setups should use `timestamp(3)` or add a unique
  tie-breaker that doesn't depend on the timestamp. This goes in the "Sorting & nulls" docs page.
- **MongoDB version.** The Mongoose suite runs on MongoDB 7.0. MongoDB 8.x up to 8.3.13 exits at
  startup on the Ubuntu Azure kernel GitHub's runners use (`7.0.0-*-azure`), because its kernel
  check misreads Ubuntu's numbering (SERVER-131779, fixed in 8.3.14). The adapter uses only
  `find`, `sort` and `limit`, which behave the same on 7.0 and 8.x, including null ordering.
  Moving back to 8.x is tracked in [#2](https://github.com/lavitsamson/keyset-kit/issues/2).
