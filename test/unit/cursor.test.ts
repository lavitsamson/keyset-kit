import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  type InvalidCursorCode,
  type SortField,
} from '../../src/index.js';

type Row = Record<string, unknown>;
const sort: SortField<Row>[] = [
  { field: 'createdAt', direction: 'desc' },
  { field: 'id', direction: 'asc' },
];

/** Builds a raw (unsigned) cursor from an arbitrary payload, to simulate hand-crafted input. */
const craft = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

function expectCursorError(fn: () => unknown, code: InvalidCursorCode, message?: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidCursorError);
    expect((err as InvalidCursorError).code).toBe(code);
    if (message) expect((err as InvalidCursorError).message).toMatch(message);
    return;
  }
  throw new Error(`expected InvalidCursorError ${code}`);
}

// Stand-ins for ORM value types, matched the same way the library detects the real ones.
class Decimal {
  constructor(private readonly value: string) {}
  toString(): string {
    return this.value;
  }
}
const decimal128 = (value: string) => ({ _bsontype: 'Decimal128', toString: () => value });
const objectId = (hex: string) => ({ _bsontype: 'ObjectId', toHexString: () => hex });

describe('encodeCursor / decodeCursor', () => {
  it('round-trips JSON values, Dates and bigints with their types intact', () => {
    const values = {
      s: 'héllo ✓ "quoted"',
      n: -12.5,
      zero: 0,
      t: true,
      f: false,
      nil: null,
      big: 2n ** 70n,
      negBig: -5n,
      at: new Date('2026-03-04T05:06:07.089Z'),
    };
    expect(decodeCursor(encodeCursor(values))).toEqual(values);
  });

  it('produces URL-safe output', () => {
    expect(encodeCursor({ s: '???///+++' })).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeCursor({ s: '???' }, { secret: 's3cret' })).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });

  it('encodes decimals and ObjectIds and decodes them as strings', () => {
    const decoded = decodeCursor(
      encodeCursor({
        price: new Decimal('12.50'),
        amount: decimal128('-0.001'),
        sci: new Decimal('1.5e+21'),
        _id: objectId('65f1c0ffee0123456789abcd'),
      }),
    );
    expect(decoded).toEqual({
      price: '12.50',
      amount: '-0.001',
      sci: '1.5e+21',
      _id: '65f1c0ffee0123456789abcd',
    });
  });

  it.each([
    ['undefined', undefined, /is undefined; select every sort field/],
    ['NaN', Number.NaN, /non-finite number NaN/],
    ['Infinity', Number.POSITIVE_INFINITY, /non-finite number Infinity/],
    ['an invalid Date', new Date('nope'), /invalid Date/],
    ['a NaN decimal', new Decimal('NaN'), /decimal "NaN"/],
    ['a plain object', { nested: 1 }, /type Object/],
    ['an array', [1, 2], /type Array/],
    ['a symbol', Symbol('x'), /type symbol/],
    ['a function', () => 1, /type function/],
    ['a null-prototype object', Object.create(null) as object, /type object/],
  ])('refuses to encode %s, naming the field', (_, value, message) => {
    expect(() => encodeCursor({ field: value })).toThrow(message);
    expect(() => encodeCursor({ field: value })).toThrow(/"field"/);
  });

  describe('sort binding', () => {
    it('stores only the sort fields and decodes under the same sort', () => {
      const row = { id: 7, createdAt: new Date('2026-01-01T00:00:00Z'), title: 'ignored' };
      const cursor = encodeCursor(row, { sort });
      expect(decodeCursor(cursor, { sort })).toEqual({ createdAt: row.createdAt, id: 7 });
    });

    it('rejects a cursor created under a different sort with SORT_MISMATCH', () => {
      const cursor = encodeCursor({ createdAt: new Date(0), id: 1 }, { sort });
      const flipped: SortField<Row>[] = [
        { field: 'createdAt', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ];
      expectCursorError(
        () => decodeCursor(cursor, { sort: flipped }),
        'SORT_MISMATCH',
        /different sort/,
      );
    });

    it('rejects an unbound cursor when a sort is required', () => {
      const cursor = encodeCursor({ createdAt: new Date(0), id: 1 });
      expectCursorError(() => decodeCursor(cursor, { sort }), 'SORT_MISMATCH');
    });

    it('rejects a cursor whose fields do not match its sort hash', () => {
      const valid = encodeCursor({ createdAt: new Date(0), id: 1 }, { sort });
      const [, hash] = JSON.parse(Buffer.from(valid, 'base64url').toString('utf8')) as [
        number,
        string,
      ];
      expectCursorError(
        () => decodeCursor(craft([1, hash, { createdAt: 1, other: 2 }]), { sort }),
        'INVALID_CURSOR',
        /fields do not match/,
      );
      expectCursorError(
        () => decodeCursor(craft([1, hash, { createdAt: 1 }]), { sort }),
        'INVALID_CURSOR',
      );
    });
  });

  describe('signing', () => {
    const secret = 'correct horse battery staple';
    const values = { id: 42 };

    it('verifies a cursor signed with the same secret', () => {
      expect(decodeCursor(encodeCursor(values, { secret }), { secret })).toEqual(values);
    });

    it('rejects a wrong secret, a modified payload or a modified signature', () => {
      const cursor = encodeCursor(values, { secret });
      const [payload = '', signature = ''] = cursor.split('.');
      const forgedPayload = encodeCursor({ id: 1 });

      expectCursorError(() => decodeCursor(cursor, { secret: 'other' }), 'TAMPERED_CURSOR');
      expectCursorError(
        () => decodeCursor(`${forgedPayload}.${signature}`, { secret }),
        'TAMPERED_CURSOR',
      );
      expectCursorError(
        () => decodeCursor(`${payload}.${signature.slice(1)}`, { secret }),
        'TAMPERED_CURSOR',
      );
      expectCursorError(() => decodeCursor(`${payload}.`, { secret }), 'TAMPERED_CURSOR');
    });

    it('rejects an unsigned cursor when a secret is configured', () => {
      expectCursorError(
        () => decodeCursor(encodeCursor(values), { secret }),
        'TAMPERED_CURSOR',
        /not signed/,
      );
    });

    it('rejects a signed cursor when no secret is configured', () => {
      expectCursorError(
        () => decodeCursor(encodeCursor(values, { secret })),
        'INVALID_CURSOR',
        /pass the `secret`/,
      );
    });

    it('requires a non-empty secret', () => {
      expect(() => encodeCursor(values, { secret: '' })).toThrow(
        /`secret` must be a non-empty string/,
      );
      expect(() => decodeCursor('abc', { secret: '' })).toThrow(TypeError);
    });
  });

  describe('malformed input', () => {
    it.each([
      ['an empty string', ''],
      ['a non-string', 42],
      ['an oversized string', 'a'.repeat(4097)],
      ['non-base64url characters', 'abc$%^'],
      ['non-JSON content', Buffer.from('not json').toString('base64url')],
      ['a non-array payload', craft({ v: 1 })],
      ['a payload of the wrong length', craft([1, null])],
      ['an unknown version', craft([2, null, {}])],
      ['a non-string hash', craft([1, 5, {}])],
      ['values as an array', craft([1, null, [1]])],
      ['values as null', craft([1, null, null])],
      ['an unknown tag', craft([1, null, { a: ['x', '1'] }])],
      ['a bad date', craft([1, null, { a: ['d', 'nope'] }])],
      ['a bad bigint', craft([1, null, { a: ['b', '1.5'] }])],
      ['a bad decimal', craft([1, null, { a: ['n', 'abc'] }])],
      ['a bad ObjectId', craft([1, null, { a: ['o', 'xyz'] }])],
      ['a non-string tagged value', craft([1, null, { a: ['d', 5] }])],
      ['a nested object value', craft([1, null, { a: { b: 1 } }])],
    ])('rejects %s with INVALID_CURSOR', (_, cursor) => {
      expectCursorError(() => decodeCursor(cursor as string), 'INVALID_CURSOR');
    });

    it('never lets a "__proto__" key pollute prototypes', () => {
      const decoded = decodeCursor(craft([1, null, JSON.parse('{"__proto__": 1, "polluted": 2}')]));
      expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
      expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
      expect(decoded['__proto__']).toBe(1);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
  });
});
