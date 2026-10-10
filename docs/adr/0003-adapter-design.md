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
