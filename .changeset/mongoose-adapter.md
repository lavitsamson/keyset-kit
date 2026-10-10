---
'keyset-kit': minor
---

Add the Mongoose adapter (`keyset-kit/mongoose`): `paginateMongoose(query, options)` for lean and hydrated queries. It follows MongoDB's fixed null ordering (and rejects contradicting `nulls` options), treats missing fields like null, validates sort fields against the schema and rejects projections that exclude a sort field.
