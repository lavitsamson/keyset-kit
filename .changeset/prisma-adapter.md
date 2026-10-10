---
'keyset-kit': minor
---

Add the Prisma adapter (`keyset-kit/prisma`): `paginatePrisma(delegate, { where, select, include }, options)`. Optional options now also accept an explicit `undefined`, so values like `process.env.CURSOR_SECRET` can be passed directly. Decimal detection no longer relies on class names, which Prisma 7 minifies.
