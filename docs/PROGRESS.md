# Progress

## 1. Setup

- [x] npm name check: `keyset-kit` is available (`npm view keyset-kit` → 404, 2026-10-10)
- [x] Git repository, pnpm 12 workspace, Node 24 LTS for development (`.node-version`), Node ≥ 22 supported
- [x] Supply-chain guards: `minimumReleaseAge` (14 days), `allowBuilds`, SHA-pinned Actions
- [x] TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
- [x] tsup dual ESM/CJS build with `.d.ts`/`.d.cts`, 5-entry `exports` map, `sideEffects: false`
- [x] Vitest (unit + `expectTypeOf` type tests) with coverage thresholds (core 95%, overall 90%)
- [x] ESLint (typescript-eslint strict type-checked) + Prettier
- [x] publint + attw, size-limit (core ≤ 3 kB)
- [x] Changesets config
- [x] CI skeleton (Node 22 + 24): lint → typecheck → tests → build → package checks → size
- [x] README skeleton, ADR 0001 (toolchain)

## 2. Core

- [x] `encodeCursor` / `decodeCursor` (base64url compact tuple, typed tagging for Date/bigint/decimal/ObjectId)
- [x] HMAC-SHA256 signing with constant-time verification (`node:crypto`)
- [x] Sort-spec hashing (`SORT_MISMATCH`) and sort validation; tie-breaker uniqueness checked in `toPage`
- [x] `buildKeysetCondition` AST (multi-column, per-field direction, nulls)
- [x] `toPage` (limit + 1, backwards pagination, `pageInfo`) + internal `preparePagination` for adapters
- [x] Unit + property-based tests (forward/backward walk, previous page, stability under inserts)
- [x] ADR 0002 (cursor format and ordering semantics)

Notes: core coverage 100% lines / 99.5% branches; core size 2.86 kB min+gzip (budget 3 kB).
`CursorOptions` gained an optional `sort` field beyond the original spec (see ADR 0002).

## 3. Prisma adapter

- [x] `paginatePrisma` (structural delegate type, AND with caller filter, select/include pass-through)
- [x] Shared conformance suite (`test/integration/conformance.ts`) on PostgreSQL 18.6 via Testcontainers
- [x] CI integration step (+ `pnpm generate` for the test Prisma client)
- [x] ADR 0003 (adapter design and conformance suite)

Notes: the conformance suite caught Prisma 7's minified `Decimal2` class name; decimal detection now
uses `Symbol.toStringTag`. Optional options now accept explicit `undefined` (e.g. `process.env`).

## 4. TypeORM adapter

- [x] `paginateQueryBuilder` (clones the builder, groups caller conditions, validates fields against metadata, `take` for joins)
- [x] Conformance suite on PostgreSQL 18.6 (plus OR-precedence, join, immutability and validation tests)
- [x] Coverage measured over unit + integration (Vitest projects)

Notes: verified under several local timezones (Europe/Berlin, America/New_York, Asia/Kolkata).

## 5. Mongoose adapter

- [x] `paginateMongoose` (lean and hydrated queries, `$and` with caller filter, schema-path validation, projection check)
- [x] Conformance suite on MongoDB 8.3.9 (fixed null-order mode) plus ObjectId tie-breaker, missing-field, `$or`, projection and immutability tests
- [x] MongoDB null ordering documented (README "Database notes", ADR 0003)

## 6. Express middleware

- [ ] `keysetParams` (parsing, validation, 400 Problem Details)
- [ ] `setLinkHeader` (RFC 8288)

## 7. Examples + docs site

- [ ] `examples/express-prisma`, `examples/express-mongoose`, `examples/nestjs-typeorm` (+ CI smoke test)
- [ ] VitePress site + TypeDoc, GitHub Pages workflow

## 8. Benchmarks

- [ ] 1M-row dataset, OFFSET vs keyset at depths 1/100/1k/10k, `EXPLAIN ANALYZE`
- [ ] `bench/RESULTS.md` (measured only) embedded in README

## 9. Release 1.0.0

- [ ] Release workflow (Changesets + npm provenance), badges, GitHub release notes
