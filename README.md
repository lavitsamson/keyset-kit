# keyset-kit

Tiny, type-safe keyset (cursor) pagination for Prisma, TypeORM, Mongoose and Express. Zero runtime dependencies.

<!-- Badges (CI, npm version, bundle size) are added once the GitHub repository and npm package are live. -->

> **Status:** pre-release, under active development. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Why

`OFFSET` pagination gets slower the deeper you page, because the database still reads and throws
away every skipped row. It also returns duplicates or skips rows when data changes between
requests. Keyset pagination fixes both by continuing from the last row you saw, but getting
multi-column sorts, ties, nulls and tamper-proof cursors right is fiddly. `keyset-kit` handles
all of that in a few lines of code.

## Install

```sh
npm install keyset-kit
```

## Quick start

_Coming in Milestone 3 (Express + Prisma example)._

## Entry points

| Import                | Purpose                                                 | Peer dependency  |
| --------------------- | ------------------------------------------------------- | ---------------- |
| `keyset-kit`          | Cursor encoding/signing, keyset condition AST, `toPage` | none             |
| `keyset-kit/prisma`   | `paginatePrisma`                                        | `@prisma/client` |
| `keyset-kit/typeorm`  | `paginateQueryBuilder`                                  | `typeorm`        |
| `keyset-kit/mongoose` | `paginateMongoose`                                      | `mongoose`       |
| `keyset-kit/express`  | `keysetParams` middleware, `setLinkHeader`              | `express`        |

## Development

Requires Node ≥ 22 and pnpm (via Corepack: `corepack enable`).

```sh
pnpm install
pnpm lint            # ESLint + (pnpm format:check for Prettier)
pnpm typecheck
pnpm test            # unit + type tests (pnpm test:coverage for coverage)
pnpm build           # tsup → dist/ (ESM + CJS + .d.ts)
pnpm check:package   # publint + are-the-types-wrong
pnpm size            # size-limit (core ≤ 3 kB min+gzip)
```

## Design decisions

- [ADR 0001: Build and language toolchain](docs/adr/0001-toolchain.md): why TypeScript 6 + tsup, Node ≥ 22, and pnpm's supply-chain guards.

## Author

**Lavit Samson**, Senior Full-Stack Engineer · [linkedin.com/in/lavit-samson](https://linkedin.com/in/lavit-samson)

## License

[MIT](LICENSE)
