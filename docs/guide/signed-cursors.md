# Signed cursors

A cursor is base64url-encoded JSON: readable by anyone who decodes it, and editable. That's fine
for internal tools. For public APIs, set a `secret` so cursors are signed with HMAC-SHA256 and
verified on the way back in:

```ts
const options = { sort, after: req.query.after, secret: process.env.CURSOR_SECRET };
```

With the Express middleware, put `secret` in the `keysetParams()` config. It verifies cursors and
passes the secret on in `req.keyset`.

## What signing guarantees

- A cursor modified by a client is rejected with `TAMPERED_CURSOR`.
- An unsigned cursor is rejected while a secret is configured (`TAMPERED_CURSOR`), and a signed one
  is rejected when none is (`INVALID_CURSOR`), which catches services configured differently.
- Signatures are compared in constant time and checked **before** the payload is parsed.

Signing doesn't hide the cursor's contents: the values of the last row's sort fields are visible
to anyone who base64-decodes it. Don't sort by fields you wouldn't show to the client.

## Choosing and rotating the secret

- Use a long random value (32+ bytes) from your secret store, for example
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- Changing the secret invalidates all outstanding cursors: clients get a 400 and restart from the
  first page. That's usually acceptable for pagination; if not, deploy at a quiet time.

## Sort binding

Independently of signing, every cursor that `toPage` or an adapter creates carries a short hash of
its sort spec. Using it with a different sort (say `?sort=title` with a cursor from the default
`-createdAt` order) is rejected with `SORT_MISMATCH` instead of returning a meaningless page.
