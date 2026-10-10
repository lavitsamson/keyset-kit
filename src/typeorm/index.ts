import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { preparePagination, toPage } from '../core/page.js';
import { hasDefaultNulls, type ResolvedSortField } from '../core/sort.js';
import type { KeysetCondition, Page, PaginateOptions } from '../core/types.js';

const OPERATORS = { gt: '>', lt: '<', eq: '=' } as const;
const PARAM_PREFIX = 'keyset_kit_';

/**
 * Paginates a TypeORM `SelectQueryBuilder` with keyset (cursor) pagination.
 *
 * The builder is cloned, never modified. Its existing `WHERE` is wrapped in parentheses and
 * ANDed with the keyset condition, so `.where(a).orWhere(b)` keeps its meaning. Any existing
 * `ORDER BY` is replaced by `options.sort`. Rows are limited with `take`, which stays correct when
 * one-to-many relations are joined. Sort fields must be properties of the entity behind `alias`.
 *
 * @example
 * ```ts
 * import { paginateQueryBuilder } from 'keyset-kit/typeorm';
 *
 * const qb = dataSource
 *   .getRepository(Post)
 *   .createQueryBuilder('post')
 *   .where('post.published = :published', { published: true });
 *
 * const page = await paginateQueryBuilder(qb, 'post', {
 *   sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
 *   after: req.query.after,
 * });
 * ```
 */
export async function paginateQueryBuilder<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  options: PaginateOptions<T>,
): Promise<Page<T>> {
  const prepared = preparePagination(options);
  const query = qb.clone();
  const column = columnResolver(query, alias, prepared.sort);

  prepared.sort.forEach((s, i) => {
    const order = s.direction === 'asc' ? 'ASC' : 'DESC';
    const nulls = hasDefaultNulls(s)
      ? undefined
      : s.nulls === 'first'
        ? 'NULLS FIRST'
        : 'NULLS LAST';
    if (i === 0) query.orderBy(column(s.field), order, nulls);
    else query.addOrderBy(column(s.field), order, nulls);
  });

  if (prepared.where) {
    const parameters: Record<string, unknown> = {};
    const sql = toTypeormWhere(prepared.where, column, parameters);
    const existing = query.expressionMap.wheres;
    if (existing.length > 0) {
      // Parenthesise the caller's conditions so a trailing OR cannot swallow the keyset filter.
      query.expressionMap.wheres = [
        { type: 'simple', condition: { operator: 'brackets', condition: existing } },
      ];
    }
    query.andWhere(`(${sql})`, parameters);
  }

  return toPage(await query.take(prepared.take).getMany(), options);
}

/**
 * @internal Translates the core condition AST into a SQL fragment with named parameters.
 * Columns come from `column`, which only returns validated `alias.property` paths.
 */
export function toTypeormWhere(
  condition: KeysetCondition,
  column: (field: string) => string,
  parameters: Record<string, unknown>,
): string {
  switch (condition.type) {
    case 'and':
    case 'or':
      return condition.conditions
        .map((c) => `(${toTypeormWhere(c, column, parameters)})`)
        .join(condition.type === 'and' ? ' AND ' : ' OR ');
    case 'null':
      return `${column(condition.field)} IS ${condition.isNull ? '' : 'NOT '}NULL`;
    case 'compare': {
      const name = `${PARAM_PREFIX}${String(Object.keys(parameters).length)}`;
      parameters[name] = condition.value;
      return `${column(condition.field)} ${OPERATORS[condition.operator]} :${name}`;
    }
  }
}

/**
 * Checks the alias and every sort field against the entity metadata, then returns a mapper to
 * `alias.property` paths (which TypeORM resolves to real column names). Field names never reach
 * the SQL unless they are actual entity properties.
 */
function columnResolver<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  alias: string,
  sort: readonly ResolvedSortField[],
): (field: string) => string {
  const target = query.expressionMap.aliases.find((a) => a.name === alias);
  if (!target?.hasMetadata) {
    throw new TypeError(
      `keyset-kit: "${alias}" is not an entity alias of this query builder. Pass the alias used in createQueryBuilder().`,
    );
  }
  for (const s of sort) {
    if (!target.metadata.findColumnWithPropertyPath(s.field)) {
      throw new TypeError(
        `keyset-kit: "${s.field}" is not a column of ${target.metadata.name}. Sort fields must be entity properties.`,
      );
    }
  }
  return (field) => `${alias}.${field}`;
}
