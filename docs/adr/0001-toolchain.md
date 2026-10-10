# ADR 0001: Build and language toolchain

- Status: Accepted
- Date: 2026-10-10

## Context

`keyset-kit` ships dual ESM + CJS builds with type declarations, must stay under 3 kB min+gzip for
the core, and must type-check under `strict` with `exactOptionalPropertyTypes`. The project rules
also require every dependency version to be at least 14 days old.

When the project was set up, the newest TypeScript was 7.0 (the native Go port). The newest
typescript-eslint (8.70) supports `typescript >=4.8.4 <6.1.0`, and tsup generates `.d.ts` files
through the TypeScript JavaScript compiler API, which the native TypeScript 7 build doesn't provide.

## Decision

- **TypeScript 6.0.x**: the newest release that the lint and declaration tooling supports.
  We move to 7.x once typescript-eslint and the declaration bundler support it.
- **tsup** builds ESM + CJS + `.d.ts` / `.d.cts` for five entry points (`.`, `./prisma`,
  `./typeorm`, `./mongoose`, `./express`). tsup's declaration worker sets `baseUrl` internally,
  which TypeScript 6 deprecates, so the dts build only sets `ignoreDeprecations: "6.0"`. The
  project's own `tsconfig.json` doesn't silence anything.
- **Node >= 22** for consumers: Node 20 reached end-of-life in April 2026. CI tests every supported LTS line (22, 24). Development uses Node 24 (Active LTS), pinned in `.node-version`. `@types/node` tracks the oldest supported line (22) so the code can't use APIs that Node 22 lacks.
- **attw `node16` profile**: the legacy `node10` resolution mode can't read subpath `exports`,
  and no supported Node or TypeScript setup that can run this package still uses it.
- **pnpm `minimumReleaseAge: 20160`** (14 days) and `allowBuilds` (only esbuild may run install
  scripts) enforce the supply-chain rules in the package manager instead of relying on review.
  GitHub Actions are pinned to commit SHAs for the same reason.

## Consequences

- The TypeScript 6 to 7 upgrade becomes its own task once the ecosystem catches up.
- tsup is in maintenance mode; tsdown is its likely successor. Switching later is contained to
  `tsup.config.ts` and `package.json` scripts because the `exports` map is written by hand.
