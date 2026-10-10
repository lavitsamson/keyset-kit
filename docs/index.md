---
layout: home

hero:
  name: keyset-kit
  text: Cursor pagination that stays correct
  tagline: Tiny, type-safe keyset pagination for Prisma, TypeORM, Mongoose and Express. Zero runtime dependencies.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why keyset pagination?
      link: /guide/why-keyset

features:
  - title: Fast at any depth
    details: Each page continues from the last row seen, so page 10,000 costs the same as page 1. No OFFSET scan, no count query.
  - title: Correct while data changes
    details: Rows inserted between requests never cause duplicates or skipped rows. Property-based tests check this on real databases.
  - title: Multi-column sorts, nulls and ties
    details: Per-field direction and null ordering, with a unique tie-breaker so the order is total.
  - title: Tamper-proof cursors
    details: Optional HMAC-SHA256 signing. Cursors are bound to their sort order and keep Dates, bigints and decimals intact.
  - title: Typed end to end
    details: Sort fields are checked against your model. Query-string sorts are validated against an allow-list by the Express middleware.
  - title: One API, four integrations
    details: Prisma, TypeORM, Mongoose and Express share one core and one conformance suite.
---
