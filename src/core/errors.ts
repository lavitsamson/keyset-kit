/** Machine-readable reason a cursor was rejected. */
export type InvalidCursorCode = 'INVALID_CURSOR' | 'TAMPERED_CURSOR' | 'SORT_MISMATCH';

/**
 * Thrown when a cursor cannot be used: it is malformed, its signature does not
 * verify, or it was produced under a different sort specification.
 *
 * @example
 * ```ts
 * try {
 *   decodeCursor(req.query.after, { secret });
 * } catch (err) {
 *   if (err instanceof InvalidCursorError) res.status(400).json({ code: err.code });
 * }
 * ```
 */
export class InvalidCursorError extends Error {
  /** Always `'InvalidCursorError'`. */
  override readonly name = 'InvalidCursorError';
  /** Why the cursor was rejected. */
  readonly code: InvalidCursorCode;

  constructor(code: InvalidCursorCode, message: string) {
    super(message);
    this.code = code;
  }
}
