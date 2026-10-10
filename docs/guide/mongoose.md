# Mongoose

```ts
import { paginateMongoose } from 'keyset-kit/mongoose';

const page = await paginateMongoose(Post.find({ published: true }).lean(), {
  sort: [
    { field: 'createdAt', direction: 'desc' },
    { field: '_id', direction: 'asc' },
  ],
  after: req.query.after,
});
```

Pass a query from `Model.find()`, with or without `.lean()`. The row type is inferred from it. The
query is cloned, never modified; its filter is combined with the keyset condition using `$and`, and
any sort on it is replaced.

## Null ordering is fixed in MongoDB

MongoDB always sorts `null` and **missing** fields as the smallest values: first when ascending,
last when descending. It can't be changed. So the adapter:

- applies that order to fields without a `nulls` option;
- rejects a `nulls` option MongoDB can't honour (for example `nulls: 'last'` on an ascending field)
  with an error instead of returning wrong pages;
- treats a missing field like `null` in cursors, matching MongoDB's sort.

Because missing fields read as `null`, a sort field left out by a projection would give wrong
cursors silently. The adapter rejects a `.select()` that excludes a sort field.

## Things to know

- **Use `_id` as the tie-breaker.** It's unique and indexed.
- **One BSON type per sort field.** MongoDB's `$gt`/`$lt` only match values of the same type, so a
  field that mixes numbers and strings can't be paginated reliably.
- **Index the sort**: `schema.index({ createdAt: -1, _id: 1 })`.
- **Field names are validated** against the schema, so a value like `$where` can't become an operator.
- ObjectIds and Decimal128s in cursors come back as strings; Mongoose casts them through the schema.

See `examples/express-mongoose` for a complete app.
