import { buildPage, preparePagination, type ReadField } from '../core/page.js';
import { resolveSort } from '../core/sort.js';
import type { KeysetCondition, Page, PaginateOptions, SortField } from '../core/types.js';

/**
 * The parts of a Mongoose `Query` the adapter uses (`Model.find(...)`, optionally `.lean()`).
 * Typed structurally so the adapter does not import `mongoose`; the row type is inferred from
 * what the query resolves to.
 */
export interface MongooseQuery<T> {
  model: { schema: { path(path: string): unknown } };
  projection(): unknown;
  clone(): MongooseQuery<T>;
  and(conditions: never): unknown;
  sort(sort: never, options: never): unknown;
  limit(limit: number): unknown;
  exec(): PromiseLike<T[]>;
}

type MongoFilter = Record<string, unknown>;

/**
 * Paginates a Mongoose query with keyset (cursor) pagination.
 *
 * The query is cloned, never modified. Its filter is combined with the keyset condition using
 * `$and`; any existing sort is replaced by `options.sort`. MongoDB always sorts null and missing
 * values first ascending and last descending, so omitted `nulls` options follow that order and a
 * contradicting `nulls` option is rejected. Each sort field should hold a single BSON type,
 * because MongoDB range operators only match values of the same type.
 *
 * @example
 * ```ts
 * import { paginateMongoose } from 'keyset-kit/mongoose';
 *
 * const page = await paginateMongoose(Post.find({ published: true }).lean(), {
 *   sort: [{ field: 'createdAt', direction: 'desc' }, { field: '_id', direction: 'asc' }],
 *   after: req.query.after,
 * });
 * ```
 */
export async function paginateMongoose<T>(
  query: MongooseQuery<T>,
  options: PaginateOptions<T>,
): Promise<Page<T>> {
  const mongoOptions: PaginateOptions<T> = { ...options, sort: withMongoNullOrder(options.sort) };
  const prepared = preparePagination(mongoOptions);

  for (const s of prepared.sort) {
    if (query.model.schema.path(s.field) == null) {
      throw new TypeError(
        `keyset-kit: "${s.field}" is not a path in the model's schema. Sort fields must be schema paths.`,
      );
    }
  }

  assertProjected(
    query.projection(),
    prepared.sort.map((s) => s.field),
  );

  const q = query.clone();
  if (prepared.where) {
    (q.and as (conditions: MongoFilter[]) => unknown).call(q, [toMongoFilter(prepared.where)]);
  }
  const sort = prepared.sort.map((s): [string, 1 | -1] => [
    s.field,
    s.direction === 'asc' ? 1 : -1,
  ]);
  (q.sort as (sort: [string, 1 | -1][], options: { override: boolean }) => unknown).call(q, sort, {
    override: true,
  });
  q.limit(prepared.take);

  return buildPage(await q.exec(), mongoOptions, readMissingAsNull);
}

/** MongoDB sorts a missing field like null, so cursors must treat it the same way. */
const readMissingAsNull: ReadField = (row, field) =>
  (row as Record<string, unknown>)[field] ?? null;

/**
 * @internal Since missing fields read as null, a sort field excluded by the projection would
 * silently produce wrong cursors. Reject that up front.
 */
export function assertProjected(projection: unknown, fields: readonly string[]): void {
  if (typeof projection !== 'object' || projection === null) return;
  const spec = projection as Record<string, unknown>;
  const isIncluded = (value: unknown): boolean => value === 1 || value === true;
  const inclusive = Object.entries(spec).some(([key, value]) => key !== '_id' && isIncluded(value));
  for (const field of fields) {
    const value = spec[field];
    const excluded =
      value === 0 || value === false || (inclusive && field !== '_id' && !isIncluded(value));
    if (excluded) {
      throw new TypeError(
        `keyset-kit: sort field "${field}" is excluded by the query projection. Select every sort field.`,
      );
    }
  }
}

/** @internal Translates the core condition AST into a MongoDB filter. */
export function toMongoFilter(condition: KeysetCondition): MongoFilter {
  switch (condition.type) {
    case 'and':
      return { $and: condition.conditions.map(toMongoFilter) };
    case 'or':
      return { $or: condition.conditions.map(toMongoFilter) };
    case 'null':
      // `{ field: null }` also matches documents where the field is missing, as sorting does.
      return { [condition.field]: condition.isNull ? null : { $ne: null } };
    case 'compare':
      return { [condition.field]: { [`$${condition.operator}`]: condition.value } };
  }
}

/**
 * @internal Makes MongoDB's fixed null ordering explicit (first ascending, last descending) and
 * rejects sort fields that ask for the opposite.
 */
export function withMongoNullOrder<T>(sort: readonly SortField<T>[]): SortField<T>[] {
  resolveSort(sort); // validate shape first, for the usual actionable errors
  return sort.map((s) => {
    const natural = s.direction === 'asc' ? 'first' : 'last';
    if (s.nulls !== undefined && s.nulls !== natural) {
      throw new TypeError(
        `keyset-kit: MongoDB always sorts nulls ${natural} for '${s.direction}', but "${s.field}" ` +
          `asks for nulls '${s.nulls}'. Remove the nulls option for this field.`,
      );
    }
    return { ...s, nulls: natural };
  });
}
