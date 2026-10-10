import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvalidCursorError } from './errors.js';
import { resolveSort, sortHash, type ResolvedSortField } from './sort.js';
import type { CursorOptions } from './types.js';

/** Format version, bumped if the encoded layout ever changes. */
const VERSION = 1;
/** Upper bound on accepted cursor length, so hostile input cannot force large allocations. */
const MAX_CURSOR_LENGTH = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const BIGINT = /^-?\d+$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** JSON-safe cursor value. Non-JSON types become `[tag, string]`; raw values are never arrays. */
type TaggedValue = string | number | boolean | null | [tag: 'd' | 'b' | 'n' | 'o', value: string];

/**
 * Encodes sort-key values into an opaque, URL-safe cursor.
 *
 * Supported values: string, finite number, boolean, null, bigint, Date, decimals (Prisma
 * `Decimal`, BSON `Decimal128`) and BSON `ObjectId`. Pass `sort` to store only the sort fields
 * and bind the cursor to that sort order; pass `secret` to sign it.
 *
 * @example
 * ```ts
 * const cursor = encodeCursor(
 *   { createdAt: new Date('2026-01-01'), id: 42 },
 *   { secret: process.env.CURSOR_SECRET },
 * );
 * ```
 */
export function encodeCursor(values: Record<string, unknown>, opts: CursorOptions = {}): string {
  return encodeResolved(values, opts.sort ? resolveSort(opts.sort) : null, opts.secret);
}

/**
 * Decodes a cursor produced by `encodeCursor`, restoring Dates and bigints. Decimals and
 * ObjectIds come back as strings, which Prisma, TypeORM and Mongoose accept in filters.
 *
 * @throws {InvalidCursorError} `INVALID_CURSOR` when malformed, `TAMPERED_CURSOR` when the
 * signature is missing or wrong, `SORT_MISMATCH` when `sort` differs from the one it was made with.
 *
 * @example
 * ```ts
 * try {
 *   const { createdAt, id } = decodeCursor(req.query.after, { secret });
 * } catch (err) {
 *   if (err instanceof InvalidCursorError) return res.status(400).end();
 *   throw err;
 * }
 * ```
 */
export function decodeCursor(cursor: string, opts: CursorOptions = {}): Record<string, unknown> {
  return decodeResolved(cursor, opts.sort ? resolveSort(opts.sort) : null, opts.secret);
}

/** @internal Encode with an already-resolved sort spec (or `null` to store every key). */
export function encodeResolved(
  values: Record<string, unknown>,
  sort: readonly ResolvedSortField[] | null,
  secret: string | undefined,
): string {
  assertSecret(secret);
  const fields = sort ? sort.map((s) => s.field) : Object.keys(values);
  const tagged = Object.fromEntries(fields.map((f) => [f, tag(f, values[f])]));
  const json = JSON.stringify([VERSION, sort ? sortHash(sort) : null, tagged]);
  const payload = Buffer.from(json, 'utf8').toString('base64url');
  return secret === undefined ? payload : `${payload}.${sign(payload, secret)}`;
}

/** @internal Decode with an already-resolved sort spec (or `null` to skip the sort check). */
export function decodeResolved(
  cursor: string,
  sort: readonly ResolvedSortField[] | null,
  secret: string | undefined,
): Record<string, unknown> {
  assertSecret(secret);
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
    throw invalid(
      `Cursor must be a non-empty string of at most ${String(MAX_CURSOR_LENGTH)} characters.`,
    );
  }

  const dot = cursor.indexOf('.');
  const payload = dot === -1 ? cursor : cursor.slice(0, dot);
  const signature = dot === -1 ? null : cursor.slice(dot + 1);

  // Verify before parsing, so unsigned or forged input never reaches JSON.parse when signing is on.
  if (secret !== undefined) {
    if (signature === null) {
      throw new InvalidCursorError(
        'TAMPERED_CURSOR',
        'Cursor is not signed, but a secret is configured.',
      );
    }
    if (!safeEqual(signature, sign(payload, secret))) {
      throw new InvalidCursorError(
        'TAMPERED_CURSOR',
        'Cursor signature is invalid: modified, or signed with another secret.',
      );
    }
  } else if (signature !== null) {
    throw invalid('Cursor is signed; pass the `secret` it was created with.');
  }

  if (!BASE64URL.test(payload)) throw invalid('Cursor is not valid base64url.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw invalid('Cursor payload is not valid JSON.');
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed[0] !== VERSION ||
    (parsed[1] !== null && typeof parsed[1] !== 'string') ||
    !isPlainObject(parsed[2])
  ) {
    throw invalid('Cursor payload has an unexpected shape.');
  }
  const hash = parsed[1] as string | null;
  const tagged = parsed[2];

  if (sort) {
    if (hash !== sortHash(sort)) {
      throw new InvalidCursorError(
        'SORT_MISMATCH',
        'Cursor belongs to a different sort order; restart from the first page.',
      );
    }
    const keys = Object.keys(tagged);
    if (keys.length !== sort.length || !sort.every((s) => Object.hasOwn(tagged, s.field))) {
      throw invalid('Cursor fields do not match the sort specification.');
    }
  }

  // Object.fromEntries defines own properties, so a "__proto__" key cannot touch the prototype.
  return Object.fromEntries(Object.entries(tagged).map(([k, v]) => [k, untag(v)]));
}

function tag(field: string, value: unknown): TaggedValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value === undefined) {
    throw new TypeError(
      `keyset-kit: "${field}" is undefined; select every sort field in the query.`,
    );
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `keyset-kit: cannot put non-finite number ${String(value)} ("${field}") in a cursor.`,
      );
    }
    return value;
  }
  if (typeof value === 'bigint') return ['b', value.toString()];
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`keyset-kit: cannot put an invalid Date ("${field}") in a cursor.`);
    }
    return ['d', value.toISOString()];
  }
  if (isDecimal(value)) {
    const text = (value as { toString(): string }).toString();
    if (!DECIMAL.test(text)) {
      throw new TypeError(`keyset-kit: cannot put decimal "${text}" ("${field}") in a cursor.`);
    }
    return ['n', text];
  }
  if (isObjectId(value)) return ['o', value.toHexString()];
  throw new TypeError(
    `keyset-kit: cannot put a value of type ${describe(value)} ("${field}") in a cursor. ` +
      'Supported: string, number, boolean, null, bigint, Date, Decimal, Decimal128, ObjectId.',
  );
}

function untag(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'string') {
    const text = value[1];
    switch (value[0]) {
      case 'd': {
        const date = new Date(text);
        if (!Number.isNaN(date.getTime())) return date;
        break;
      }
      case 'b':
        if (BIGINT.test(text)) return BigInt(text);
        break;
      case 'n':
        if (DECIMAL.test(text)) return text;
        break;
      case 'o':
        if (OBJECT_ID.test(text)) return text;
        break;
    }
  }
  throw invalid('Cursor contains a value that cannot be decoded.');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time string comparison (length is not secret: HMAC output length is fixed). */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertSecret(secret: string | undefined): void {
  if (secret !== undefined && (typeof secret !== 'string' || secret.length === 0)) {
    throw new TypeError('keyset-kit: `secret` must be a non-empty string.');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * decimal.js (Prisma's `Decimal`) or BSON `Decimal128`. decimal.js sets `Symbol.toStringTag`, which
 * survives bundling; constructor names do not (Prisma 7 ships it as `Decimal2`).
 */
function isDecimal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (
    (value as { _bsontype?: unknown })._bsontype === 'Decimal128' ||
    Object.prototype.toString.call(value) === '[object Decimal]'
  );
}

function isObjectId(value: unknown): value is { toHexString(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { _bsontype?: unknown })._bsontype === 'ObjectId' &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function'
  );
}

function describe(value: unknown): string {
  if (typeof value !== 'object' || value === null) return typeof value;
  return (value as { constructor?: { name?: string } }).constructor?.name ?? 'object';
}

function invalid(message: string): InvalidCursorError {
  return new InvalidCursorError('INVALID_CURSOR', message);
}
