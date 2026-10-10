# FAQ

### Can users jump to an arbitrary page?

No. Keyset pagination moves from a cursor to the next or previous page. That's the price of
constant-time pages and stable results. For "page 37" you need OFFSET (with its costs) or a
different UI, such as search or date filters.

### Why must the sort end with a unique field?

If two rows have the same sort values, the database may return them in either order, and a page
boundary between them would skip or repeat one. A unique last field (usually `id`) makes the order
total. `keyset-kit` detects duplicates and nulls in that field and throws.

### Why is `hasPreviousPage` true even on the first page?

When you paginate forwards, `hasPreviousPage` reports whether a cursor was supplied, which avoids an
extra query. The Relay connection spec allows this approximation. The same goes for `hasNextPage`
when you paginate backwards.

### Is a cursor still valid after rows are deleted?

Yes. A cursor holds values, not a row reference, so the next page starts right after those values
whether or not the row still exists.

### Do I need to count rows to know if there is a next page?

No. Adapters fetch `limit + 1` rows; if the extra row exists, there is a next page.

### Can I sort by a field from a joined table?

Not directly. Sort fields are properties of the paginated model. Denormalise the value onto the
model, or paginate with the core helpers (`buildKeysetCondition` + `toPage`) over your own query.

### Does it work with GraphQL?

The output maps directly onto Relay connections (`pageInfo` has the same fields). Ready-made
connection helpers may come in a later version.

### Which databases are supported?

The adapters are tested against PostgreSQL (Prisma, TypeORM) and MongoDB (Mongoose). Other SQL
databases may work, but they aren't covered by the test suite, and their null ordering differs
from PostgreSQL's.

### Does `keyset-kit` add runtime dependencies?

No. The core has none; adapters use the ORM you already have, declared as optional peer
dependencies.
