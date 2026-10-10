# ADR 0004: Express middleware

- Status: Accepted
- Date: 2026-10-10

## Context

`keysetParams()` turns untrusted query strings (`?limit=&after=&before=&sort=-createdAt,id`) into
pagination options, and `setLinkHeader()` advertises neighbouring pages. The parsed options must
flow into any adapter without casts, while hand-written sort specs stay type-checked against the
model.

## Decisions

### `ParsedSort`: a branded type for runtime-validated sorts

A sort parsed from a query string has plain `string` field names, so it isn't assignable to
`SortField<Post>[]` (field `keyof Post`). Instead of casts or `any`, `PaginateOptions<T>.sort`
accepts `readonly SortField<T>[] | ParsedSort`. `ParsedSort` is an array of `AnySortField` with a
type-only brand that only `keysetParams()` produces, after checking every field against
`allowedSort` at runtime. So:

- `paginatePrisma(prisma.post, {}, req.keyset)` compiles with no cast;
- hand-written arrays never carry the brand, so their field names are still checked;
- `keysetParams<Post>({ allowedSort: [...] })` checks the allow-list against the model at
  compile time.

### The tie-breaker is managed for the client

Clients pick sort fields; they shouldn't have to know which column is unique. The last field of
`defaultSort` is the tie-breaker. It's appended to client sorts, and when a client sorts by it
explicitly, any fields after it are dropped: they can't change the order, and the core expects the
unique field last. A `nulls` option configured in `defaultSort` applies to the same field in client
sorts.

### Validate cursors at the edge (`secret` option)

The spec's config has no secret, but a cursor can only be fully checked (signature, sort binding)
with one. We added an optional `secret`. When it's set, cursors are verified in the middleware and
the secret is passed on in `req.keyset`. Without it, unsigned cursors are still decoded against the
parsed sort. Either way, malformed, tampered and wrong-sort cursors get a 400 instead of surfacing
later as an exception inside the route handler.

### Errors: RFC 9457 Problem Details

Invalid input gets `400` with `Content-Type: application/problem+json` and
`{ type: "about:blank", title: "Bad Request", status, detail, errors: [{ parameter, detail }] }`.
All problems are reported at once, so a client can fix everything in one round trip.
`about:blank` is used because there is no stable documentation URL to point `type` at yet.

### `req.keyset` is declared non-optional

The `Express.Request` augmentation declares `keyset: KeysetQuery`, as `express-session` does for
`req.session`. Declaring it optional would force a non-null check in every handler, even though it's
always set on routes that mount the middleware. The TSDoc says it's only present on those routes.

### Relative `Link` URLs

`setLinkHeader()` emits relative references (`</api/posts?limit=5&after=…>; rel="next"`), which
RFC 8288 resolves against the request URL. Building absolute URLs would mean trusting the `Host`
header, which can be spoofed and then cached. Other query parameters are kept, the opposite cursor
is dropped, and an existing `Link` header is appended to rather than replaced.

## Consequences

- One config object covers parsing, validation and signing, and the result spreads straight into
  any adapter.
- `ParsedSort` widens `PaginateOptions.sort` by one union member. A hand-written array can't be
  passed off as one without an explicit cast.
- Express 5 is the tested and declared peer version.
