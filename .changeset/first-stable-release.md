---
'keyset-kit': major
---

First stable release. Keyset (cursor) pagination for TypeScript with zero runtime dependencies.

- **Core** (`keyset-kit`): `encodeCursor` / `decodeCursor` with typed values (Date, bigint, decimal, ObjectId), optional HMAC-SHA256 signing and sort binding (`InvalidCursorError` with `INVALID_CURSOR`, `TAMPERED_CURSOR` or `SORT_MISMATCH`); `buildKeysetCondition`, an ORM-agnostic condition AST with per-field direction, null ordering and a leading bound so PostgreSQL can use the sort index as a range; `toPage` for `limit + 1` trimming, backwards pagination and `pageInfo`.
- **Prisma** (`keyset-kit/prisma`): `paginatePrisma(delegate, { where, select, include }, options)`.
- **TypeORM** (`keyset-kit/typeorm`): `paginateQueryBuilder(qb, alias, options)`. It clones the builder, keeps the caller's `WHERE` grouped, validates sort fields against entity metadata and detects `NOT NULL` columns.
- **Mongoose** (`keyset-kit/mongoose`): `paginateMongoose(query, options)` for lean and hydrated queries, following MongoDB's fixed null ordering.
- **Express** (`keyset-kit/express`): `keysetParams(config)` parses and validates `?limit=&after=&before=&sort=` into `req.keyset` (400 Problem Details on invalid input), and `setLinkHeader(res, req, pageInfo)` sets RFC 8288 `next`/`prev` links.
- `nullable: false` on a sort field keeps ascending sorts and backwards pages on an index range scan.

Every adapter passes the same conformance suite on a real database (PostgreSQL 18, MongoDB 7). On a 1,000,000-row table, page 10,000 takes 2.3 ms with keyset against 152 ms with `OFFSET` (see `bench/RESULTS.md`).
