import { preparePagination, toPage } from '../core/page.js';
import type { ResolvedSortField } from '../core/sort.js';
import type { KeysetCondition, Page, PaginateOptions } from '../core/types.js';

/**
 * Any Prisma model delegate (`prisma.post`, `prisma.user`, ...). Typed structurally so the
 * adapter works with every generated client without importing `@prisma/client`.
 */
export interface PrismaDelegate<T> {
  findMany(args: never): PromiseLike<T[]>;
}

/** Query arguments the caller controls. Ordering and limits belong to the paginator. */
export interface PrismaPaginateArgs {
  /** Your own filter; combined with the keyset condition using `AND`. */
  where?: object;
  /** Must include every sort field. */
  select?: object;
  include?: object;
}

type PrismaWhere = Record<string, unknown>;
type PrismaOrderBy = Record<
  string,
  'asc' | 'desc' | { sort: 'asc' | 'desc'; nulls: 'first' | 'last' }
>;

/**
 * Paginates a Prisma model with keyset (cursor) pagination.
 *
 * Fetches `limit + 1` rows ordered by `options.sort`, then returns the page and its cursors.
 * Tested against PostgreSQL, whose default null ordering the core uses (see "Sorting & nulls").
 *
 * @example
 * ```ts
 * import { paginatePrisma } from 'keyset-kit/prisma';
 *
 * const page = await paginatePrisma(
 *   prisma.post,
 *   { where: { published: true } },
 *   {
 *     sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
 *     limit: 20,
 *     after: req.query.after,
 *     secret: process.env.CURSOR_SECRET,
 *   },
 * );
 * ```
 */
export async function paginatePrisma<T>(
  delegate: PrismaDelegate<T>,
  args: PrismaPaginateArgs,
  options: PaginateOptions<T>,
): Promise<Page<T>> {
  const prepared = preparePagination(options);
  const keyset = prepared.where ? toPrismaWhere(prepared.where) : undefined;
  const where = args.where && keyset ? { AND: [args.where, keyset] } : (keyset ?? args.where);

  const query: Record<string, unknown> = {
    orderBy: toPrismaOrderBy(prepared.sort),
    take: prepared.take,
  };
  if (where) query['where'] = where;
  if (args.select) query['select'] = args.select;
  if (args.include) query['include'] = args.include;

  const findMany = delegate.findMany.bind(delegate) as (query: unknown) => PromiseLike<T[]>;
  return toPage(await findMany(query), options);
}

/** @internal Translates the core condition AST into a Prisma `where` object. */
export function toPrismaWhere(condition: KeysetCondition): PrismaWhere {
  switch (condition.type) {
    case 'and':
      return { AND: condition.conditions.map(toPrismaWhere) };
    case 'or':
      return { OR: condition.conditions.map(toPrismaWhere) };
    case 'null':
      return { [condition.field]: condition.isNull ? null : { not: null } };
    case 'compare': {
      const operator = condition.operator === 'eq' ? 'equals' : condition.operator;
      return { [condition.field]: { [operator]: condition.value } };
    }
  }
}

/**
 * @internal Translates the resolved sort into Prisma `orderBy`.
 *
 * When the null placement matches PostgreSQL's default for the direction, a plain direction
 * is emitted: it is equivalent, works on required (non-nullable) fields, and a plain B-tree index
 * can serve it in both directions. Otherwise `{ sort, nulls }` makes the order explicit.
 */
export function toPrismaOrderBy(sort: readonly ResolvedSortField[]): PrismaOrderBy[] {
  return sort.map((s) => {
    const isDefault = s.nulls === (s.direction === 'asc' ? 'last' : 'first');
    return { [s.field]: isDefault ? s.direction : { sort: s.direction, nulls: s.nulls } };
  });
}
