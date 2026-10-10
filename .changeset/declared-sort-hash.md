---
'keyset-kit': minor
---

Cursor sort hashes now cover the sort as declared, so cursors validated by the Express middleware are accepted by every adapter (previously MongoDB-ordered cursors failed with `SORT_MISMATCH`). The Express middleware passes sorts on exactly as configured. `KeysetCondition` nodes are now exported as named, documented types (`KeysetAndCondition`, `KeysetOrCondition`, `KeysetCompareCondition`, `KeysetNullCondition`).
