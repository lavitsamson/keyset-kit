# Progress

## 1. Setup

- [x] npm name check: `keyset-kit` is available (`npm view keyset-kit` → 404, 2026-10-10)
- [x] Git repository, pnpm 12 workspace, Node 22 (`.node-version`)
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

- [ ] `encodeCursor` / `decodeCursor` (base64url compact tuple, typed tagging for Date/bigint/decimal)
- [ ] HMAC-SHA256 signing with constant-time verification
- [ ] Sort-spec hashing (`SORT_MISMATCH`) and unique-last-field validation
- [ ] `buildKeysetCondition` AST (multi-column, per-field direction, nulls)
- [ ] `toPage` (limit + 1, backwards pagination, `pageInfo`)
- [ ] Unit + property-based tests (forward/backward walk, stability)

## 3. Prisma adapter

- [ ] `paginatePrisma`
- [ ] Shared conformance suite (`test/integration/conformance.ts`) on Postgres via Testcontainers
- [ ] CI integration step

## 4. TypeORM adapter

- [ ] `paginateQueryBuilder` + conformance on Postgres

## 5. Mongoose adapter

- [ ] `paginateMongoose` + conformance on MongoDB; document Mongo null ordering

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
