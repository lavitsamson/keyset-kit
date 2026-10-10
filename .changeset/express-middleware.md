---
'keyset-kit': minor
---

Add the Express middleware (`keyset-kit/express`): `keysetParams(config)` parses and validates `?limit=&after=&before=&sort=` into `req.keyset` (400 Problem Details on invalid input, including bad cursors), and `setLinkHeader(res, req, pageInfo)` sets RFC 8288 `next`/`prev` links. `PaginateOptions.sort` also accepts the new `ParsedSort` type, so `req.keyset` can be passed straight to any adapter.
