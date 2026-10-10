# Error handling

## Bad cursors: `InvalidCursorError`

Every cursor problem throws an `InvalidCursorError` with a machine-readable `code`:

| `code`            | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `INVALID_CURSOR`  | Not a cursor: malformed, wrong shape, too long, or signed unexpectedly. |
| `TAMPERED_CURSOR` | Signature missing or wrong (only when a `secret` is configured).        |
| `SORT_MISMATCH`   | Created for a different sort order.                                     |

These are client errors. The Express middleware already answers them with a 400. Without it,
map them yourself:

```ts
import { InvalidCursorError } from 'keyset-kit';

try {
  return await paginatePrisma(prisma.post, {}, options);
} catch (error) {
  if (error instanceof InvalidCursorError) {
    return res.status(400).json({ code: error.code, message: error.message });
  }
  throw error;
}
```

`instanceof` works across entry points: errors thrown by `keyset-kit/prisma` are instances of the
`InvalidCursorError` exported by `keyset-kit`, in both ESM and CommonJS.

## Invalid query parameters: 400 Problem Details

`keysetParams()` answers invalid `limit`, `sort`, `after` and `before` values with an
`application/problem+json` body that lists every problem. See
[Express middleware](./express#invalid-input).

## Programming errors: `TypeError` / `RangeError`

Mistakes in your code or configuration throw `TypeError` or `RangeError` with a message that
names the field and the fix, for example:

- ``keyset-kit: `sort` must be a non-empty array ending with a unique field such as id.``
- `keyset-kit: two rows share "createdAt"; end the sort with a unique field such as id.`
- `keyset-kit: "title" is undefined; select every sort field in the query.`
- `keyset-kit: "nope" is not a column of Post. Sort fields must be entity properties.`
- `keyset-kit: MongoDB always sorts nulls first for 'asc', but "score" asks for nulls 'last'.`

They indicate a bug, not bad input, so let them reach your error handler and logs.
