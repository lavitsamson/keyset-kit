---
'keyset-kit': minor
---

Add the core API: `encodeCursor` / `decodeCursor` (typed values, optional HMAC-SHA256 signing and sort binding), `buildKeysetCondition` (ORM-agnostic keyset condition AST with per-field direction and null ordering) and `toPage` (limit + 1 trimming, backwards pagination, `pageInfo`).
