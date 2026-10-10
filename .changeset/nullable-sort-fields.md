---
'keyset-kit': minor
---

Add `nullable: false` to `SortField` for columns that can't be null. Such fields (and the tie-breaker) get no `IS NULL` branches, so ascending sorts and backwards pages are index range scans too. The TypeORM adapter detects `NOT NULL` columns of the main entity automatically; the Express middleware carries `nullable` from `defaultSort` to client-chosen fields. A null in a field declared non-nullable, in a cursor or a fetched row, throws an error that names the field; this message replaces the previous tie-breaker messages.
