---
'keyset-kit': minor
---

Add the TypeORM adapter (`keyset-kit/typeorm`): `paginateQueryBuilder(qb, alias, options)`. It clones the builder, keeps the caller's `WHERE` grouped when adding the keyset condition, validates sort fields against entity metadata, and uses `take` so joins paginate by entity.
