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
- [x] Conformance suite on MongoDB 7.0.43 (fixed null-order mode) plus ObjectId tie-breaker, missing-field, `$or`, projection and immutability tests
- [x] MongoDB null ordering documented (README "Database notes", ADR 0003)

Notes: tests ran on MongoDB 8.3.9 until GitHub's runners moved to the Ubuntu Azure 7.0 kernel, where
every MongoDB 8.x release up to 8.3.13 exits at startup (SERVER-131779). CI uses 7.0.43 until an
8.3.14 image is available ([#2](https://github.com/lavitsamson/keyset-kit/issues/2)).

## 6. Express middleware

- [x] `keysetParams` (parsing, validation, tie-breaker handling, cursor checks, 400 Problem Details)
- [x] `setLinkHeader` (RFC 8288, relative URLs, keeps other params, appends to existing header)
- [x] `ParsedSort` brand so `req.keyset` spreads into any adapter without casts
- [x] ADR 0004

Notes: config gained an optional `secret` beyond the spec (see ADR 0004). Tests use a real Express
server with Node's `fetch` (no Supertest dependency).

## 7. Examples + docs site

- [x] `examples/express-prisma`, `examples/express-mongoose`, `examples/nestjs-typeorm` (one command each, versions shared via a pnpm catalog)
- [x] Examples smoke test in CI (build, seed, run, page over HTTP against Testcontainers databases)
- [x] VitePress site (all guide pages from the spec, ADRs included) + TypeDoc API reference (warnings fail the build)
- [x] GitHub Pages workflow (`.github/workflows/docs.yml`)

Notes: the Mongoose example exposed a real bug. Cursor sort hashes included database-specific null
defaults, so middleware and Mongoose disagreed. Hashes now cover the declared sort only (ADR 0002).
Repository: https://github.com/lavitsamson/keyset-kit (docs: https://lavitsamson.github.io/keyset-kit/).

## 8. Benchmarks

- [x] 1M-row dataset, OFFSET vs keyset at depths 1/100/1k/10k, `EXPLAIN ANALYZE`
- [x] `bench/RESULTS.md` (measured only) embedded in README

Notes: the first run showed keyset no faster than OFFSET with a matching index (an OR can't be an
index range). The condition now carries a leading bound on the first sort field; page 10,000 went
from 124 ms to 2.3 ms (ADR 0002). Ascending sorts and backwards pages needed an `IS NULL` branch
that defeats the index, so `SortField` gained `nullable: false` (TypeORM detects `NOT NULL`
columns automatically, Express carries it from `defaultSort`). Both cases now read 25 buffers at
depth ~200k on the benchmark table. `pnpm bench` writes `bench/RESULTS.md` and the README section;
numbers are never edited by hand. Core is 2.99 kB of its 3 kB budget.

## 9. Release 1.0.0

- [x] Release workflow (`.github/workflows/release.yml`): runs after green CI on `main`, Changesets Version Packages PR, npm trusted publishing with provenance, GitHub release from the changelog
- [x] Least-privilege release jobs (select mode, version, pack, publish), SHA-pinned, no dependency cache
- [x] One `major` changeset with the 1.0.0 release notes (replaces the pre-release changesets)
- [x] npm, size, CI, docs and license badges; `CHANGELOG.md` ships in the package
- [x] ADR 0005 (release pipeline), `docs/RELEASING.md` (one-time setup and verification)
- [x] First publish: `keyset-kit@1.0.0` on npm, `v1.0.0` tag and GitHub release (2026-10-28)
- [ ] npm trusted publisher + "disallow tokens" on the package (before the next release, see `docs/RELEASING.md`)

Notes: npm can't publish a package's first version through trusted publishing, so 1.0.0 uses a
short-lived token in the `npm` environment (still with provenance); trusted publishing takes over
afterwards. `changeset version` and `changeset pack` were dry-run locally: 0.0.0 → 1.0.0, the
generated changelog passes Prettier, and the tarball holds `dist/`, README, LICENSE and the changelog.

The publish went out with the bootstrap token, which was then revoked; the token step is gone from
`release.yml`. Getting there needed two CI fixes: allowlisting `pnpm/action-setup` and
`changesets/*` (runs had failed at startup), and moving the MongoDB tests to 7.0 (see milestone 5).
npm showed the package as under review right after the publish. Provenance still needs checking
(`npm view keyset-kit@1.0.0 dist.attestations`) once the review clears.
