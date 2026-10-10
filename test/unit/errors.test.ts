import { describe, expect, it } from 'vitest';
import { InvalidCursorError } from '../../src/index.js';

describe('InvalidCursorError', () => {
  it('carries a machine-readable code and a readable message', () => {
    const err = new InvalidCursorError('SORT_MISMATCH', 'Cursor was created for a different sort');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidCursorError);
    expect(err.name).toBe('InvalidCursorError');
    expect(err.code).toBe('SORT_MISMATCH');
    expect(err.message).toBe('Cursor was created for a different sort');
  });
});
