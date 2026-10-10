import type { Request, RequestHandler, Response } from 'express';
import { decodeResolved } from '../core/cursor.js';
import { InvalidCursorError } from '../core/errors.js';
import { resolveSort } from '../core/sort.js';
import type { AnySortField, PageInfo, ParsedSort, SortField } from '../core/types.js';

/** Configuration for `keysetParams`. Pass the model type to check field names at compile time. */
export interface KeysetParamsConfig<T = Record<string, unknown>> {
  /** Fields clients may sort by with `?sort=`. */
  allowedSort: readonly (keyof T & string)[];
  /**
   * Used when `?sort=` is absent. Its last field is the unique tie-breaker for every sort. A field's
   * `nulls` and `nullable` options here also apply when a client sorts by that field.
   */
  defaultSort: readonly SortField<T>[];
  /** Upper bound for `?limit=`; larger values are clamped. Defaults to 100. */
  maxLimit?: number | undefined;
  /** Cursor secret. When set, cursors are verified here and the secret is passed on in `req.keyset`. */
  secret?: string | undefined;
}

/** Validated pagination parameters, ready to spread into an adapter's options. */
export interface KeysetQuery {
  /** `?sort=` (or `defaultSort`), validated, with the tie-breaker appended. */
  sort: ParsedSort;
  /** `?limit=`, or `undefined` to use the paginator's default. */
  limit: number | undefined;
  /** `maxLimit` from the config. */
  maxLimit: number | undefined;
  /** `?after=` cursor, already validated. */
  after: string | null;
  /** `?before=` cursor, already validated. */
  before: string | null;
  /** `secret` from the config. */
  secret: string | undefined;
}

/** One invalid query parameter, as listed in the Problem Details `errors` member. */
export interface KeysetParamError {
  /** The offending query parameter. */
  parameter: 'limit' | 'after' | 'before' | 'sort';
  /** What is wrong and how to fix it. */
  detail: string;
}

declare global {
  // Module augmentation of Express's Request requires the namespace syntax.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `keysetParams()` from `keyset-kit/express`. Only present on routes that use it. */
      keyset: KeysetQuery;
    }
  }
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * Express middleware that parses and validates `?limit=&after=&before=&sort=` into `req.keyset`.
 *
 * `sort` is a comma-separated list of allowed fields, with `-` for descending
 * (`?sort=-createdAt,title`). The tie-breaker (last field of `defaultSort`) is appended unless
 * the client already sorts by it. Cursors are decoded against the resulting sort, so malformed,
 * tampered or wrong-sort cursors are rejected here. Invalid input gets a
 * `400 application/problem+json` response (RFC 9457) listing every problem.
 *
 * @example
 * ```ts
 * import { keysetParams, setLinkHeader } from 'keyset-kit/express';
 *
 * app.get(
 *   '/posts',
 *   keysetParams<Post>({
 *     allowedSort: ['createdAt', 'title'],
 *     defaultSort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
 *     secret: process.env.CURSOR_SECRET,
 *   }),
 *   async (req, res) => {
 *     const page = await paginatePrisma(prisma.post, {}, req.keyset);
 *     setLinkHeader(res, req, page.pageInfo);
 *     res.json(page);
 *   },
 * );
 * ```
 */
export function keysetParams<T = Record<string, unknown>>(
  config: KeysetParamsConfig<T>,
): RequestHandler {
  resolveSort(config.defaultSort); // validate up front
  // Passed on as declared: each adapter fills in its own database's default null order.
  const defaultSort: AnySortField[] = [...config.defaultSort];
  const tieBreaker = defaultSort[defaultSort.length - 1];
  if (tieBreaker === undefined) throw new TypeError('keyset-kit: `defaultSort` must not be empty.');
  // `nulls` and `nullable` declared in defaultSort also apply when a client sorts by that field.
  const configured = new Map(
    defaultSort.map((s) => {
      const options: Pick<AnySortField, 'nulls' | 'nullable'> = {};
      if (s.nulls !== undefined) options.nulls = s.nulls;
      if (s.nullable !== undefined) options.nullable = s.nullable;
      return [s.field, options] as const;
    }),
  );
  const allowed = new Set<string>(config.allowedSort);
  if (
    config.maxLimit !== undefined &&
    (!Number.isSafeInteger(config.maxLimit) || config.maxLimit < 1)
  ) {
    throw new RangeError('keyset-kit: `maxLimit` must be a positive integer.');
  }

  return (req, res, next) => {
    const errors: KeysetParamError[] = [];
    const query = req.query as Record<string, unknown>;
    const single = (parameter: KeysetParamError['parameter']): string | undefined => {
      const value = query[parameter];
      if (value === undefined || typeof value === 'string') return value;
      errors.push({ parameter, detail: `\`${parameter}\` must be given at most once.` });
      return undefined;
    };

    const rawLimit = single('limit');
    const after = single('after') ?? null;
    const before = single('before') ?? null;
    const rawSort = single('sort');

    let limit: number | undefined;
    if (rawLimit !== undefined) {
      if (POSITIVE_INTEGER.test(rawLimit) && Number.isSafeInteger(Number(rawLimit))) {
        limit = Number(rawLimit);
      } else {
        errors.push({ parameter: 'limit', detail: '`limit` must be a positive integer.' });
      }
    }
    if (after !== null && before !== null) {
      errors.push({ parameter: 'before', detail: 'Pass either `after` or `before`, not both.' });
    }

    let sort: AnySortField[] = defaultSort;
    if (rawSort !== undefined) {
      const parsed = parseSort(rawSort, allowed, errors);
      const tieIndex = parsed.findIndex((s) => s.field === tieBreaker.field);
      // Nothing after a unique field affects the order, and the core expects it to be last.
      sort = tieIndex === -1 ? [...parsed, tieBreaker] : parsed.slice(0, tieIndex + 1);
      sort = sort.map((s) => ({ ...s, ...configured.get(s.field) }));
    }

    const cursor = after ?? before;
    if (cursor !== null && errors.length === 0) {
      try {
        decodeResolved(cursor, resolveSort(sort), config.secret);
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        errors.push({ parameter: after !== null ? 'after' : 'before', detail: error.message });
      }
    }

    if (errors.length > 0) {
      res
        .status(400)
        .type('application/problem+json')
        .json({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          detail: `Invalid pagination parameters: ${errors.map((e) => e.detail).join(' ')}`,
          errors,
        });
      return;
    }

    req.keyset = {
      sort: sort as unknown as ParsedSort,
      limit,
      maxLimit: config.maxLimit,
      after,
      before,
      secret: config.secret,
    };
    next();
  };
}

function parseSort(
  raw: string,
  allowed: ReadonlySet<string>,
  errors: KeysetParamError[],
): AnySortField[] {
  const seen = new Set<string>();
  const sort: AnySortField[] = [];
  for (const token of raw.split(',')) {
    // A leading '+' (ascending) arrives as a space once the query string is decoded.
    const trimmed = token.trim().replace(/^\+/, '');
    const direction = trimmed.startsWith('-') ? 'desc' : 'asc';
    const field = direction === 'desc' ? trimmed.slice(1) : trimmed;
    if (field === '') {
      errors.push({ parameter: 'sort', detail: '`sort` contains an empty field.' });
    } else if (!allowed.has(field)) {
      errors.push({
        parameter: 'sort',
        detail: `Cannot sort by "${field}". Allowed: ${[...allowed].join(', ')}.`,
      });
    } else if (seen.has(field)) {
      errors.push({ parameter: 'sort', detail: `"${field}" appears more than once in \`sort\`.` });
    } else {
      seen.add(field);
      sort.push({ field, direction });
    }
  }
  return sort;
}

/**
 * Appends an RFC 8288 `Link` header with `rel="next"` and `rel="prev"` links for a page.
 *
 * Links are relative references (path and query of the current request), so a spoofed `Host`
 * header can never leak into them. Other query parameters such as `limit` and `sort` are kept.
 *
 * @example
 * ```ts
 * setLinkHeader(res, req, page.pageInfo);
 * // Link: </posts?limit=20&after=eyJ...>; rel="next", </posts?limit=20&before=eyJ...>; rel="prev"
 * ```
 */
export function setLinkHeader(res: Response, req: Request, pageInfo: PageInfo): void {
  const url = new URL(req.originalUrl, 'http://localhost'); // base only used for parsing
  const link = (rel: 'next' | 'prev', set: 'after' | 'before', cursor: string): string => {
    const params = new URLSearchParams(url.search);
    params.delete(set === 'after' ? 'before' : 'after');
    params.set(set, cursor);
    return `<${url.pathname}?${params.toString()}>; rel="${rel}"`;
  };

  const links: string[] = [];
  if (pageInfo.hasNextPage && pageInfo.endCursor !== null) {
    links.push(link('next', 'after', pageInfo.endCursor));
  }
  if (pageInfo.hasPreviousPage && pageInfo.startCursor !== null) {
    links.push(link('prev', 'before', pageInfo.startCursor));
  }
  if (links.length > 0) res.append('Link', links.join(', '));
}
