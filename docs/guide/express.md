# Express middleware

`keysetParams()` turns query parameters into validated pagination options; `setLinkHeader()`
advertises the neighbouring pages.

```ts
import { keysetParams, setLinkHeader } from 'keyset-kit/express';

app.get(
  '/posts',
  keysetParams<Post>({
    allowedSort: ['createdAt', 'title', 'score'],
    defaultSort: [
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
    maxLimit: 100,
    secret: process.env.CURSOR_SECRET,
  }),
  async (req, res) => {
    const page = await paginatePrisma(prisma.post, {}, req.keyset);
    setLinkHeader(res, req, page.pageInfo);
    res.json(page);
  },
);
```

## Query parameters

| Parameter | Example                  | Notes                                                  |
| --------- | ------------------------ | ------------------------------------------------------ |
| `limit`   | `?limit=50`              | Positive integer; values above `maxLimit` are clamped. |
| `after`   | `?after=<endCursor>`     | Next page.                                             |
| `before`  | `?before=<startCursor>`  | Previous page. Not together with `after`.              |
| `sort`    | `?sort=-createdAt,title` | Allowed fields, comma-separated; `-` = descending.     |

The last field of `defaultSort` is the unique tie-breaker. It's appended to every client sort, and
fields after it are dropped if a client sorts by it explicitly. A `nulls` or `nullable` option in
`defaultSort` also applies when a client picks the same field. Mark required columns with
`nullable: false` there (see [Sorting & nulls](./sorting-and-nulls#indexes)); fields that are only
in `allowedSort` are treated as nullable.

## `req.keyset`

On success, `req.keyset` holds `{ sort, limit, maxLimit, after, before, secret }`. Pass it straight
to any adapter. Its `sort` has the `ParsedSort` type, which adapters accept alongside model-typed
sorts, so no cast is needed. Passing the model type, `keysetParams<Post>(…)`, checks `allowedSort`
and `defaultSort` against the model at compile time.

## Invalid input

Invalid input is answered with `400` and an
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details body listing every problem:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid pagination parameters: `limit` must be a positive integer. Cannot sort by \"password\". Allowed: createdAt, title, score.",
  "errors": [
    { "parameter": "limit", "detail": "`limit` must be a positive integer." },
    { "parameter": "sort", "detail": "Cannot sort by \"password\". Allowed: createdAt, title, score." }
  ]
}
```

Cursors are decoded against the resulting sort, so malformed, tampered (with `secret`) and
wrong-sort cursors are rejected here too.

## `setLinkHeader(res, req, pageInfo)`

Appends an [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288) `Link` header:

```http
Link: </posts?limit=20&after=WzEs…>; rel="next", </posts?limit=20&before=WzEs…>; rel="prev"
```

Links are relative (path and query of the current request), so a spoofed `Host` header can't leak
into them. Other parameters such as `limit` and `sort` are kept, and an existing `Link` header is
appended to.
