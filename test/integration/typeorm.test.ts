import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, EntitySchema, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, PaginateOptions, SortField } from '../../src/index.js';
import { paginateQueryBuilder } from '../../src/typeorm/index.js';
import { runConformanceSuite, type ConformanceTarget, type Item } from './conformance.js';
import { POSTGRES_IMAGE } from './postgres.js';

/** TypeORM returns bigint and numeric columns as strings. */
interface ItemRow {
  id: number;
  a: number | null;
  b: string | null;
  c: Date | null;
  d: string | null;
  e: string | null;
  tags?: TagRow[];
}

interface TagRow {
  id: number;
  label: string;
  item?: ItemRow;
}

const ItemSchema = new EntitySchema<ItemRow>({
  name: 'Item',
  tableName: 'item',
  columns: {
    id: { type: 'int', primary: true },
    a: { type: 'int', nullable: true },
    b: { type: 'text', nullable: true },
    // Property and column names differ, to prove alias.property paths are mapped.
    c: { type: 'timestamp', precision: 3, nullable: true, name: 'created_at' },
    d: { type: 'bigint', nullable: true },
    e: { type: 'numeric', precision: 10, scale: 2, nullable: true },
  },
  relations: {
    tags: { type: 'one-to-many', target: 'Tag', inverseSide: 'item' },
  },
});

const TagSchema = new EntitySchema<TagRow>({
  name: 'Tag',
  tableName: 'tag',
  columns: {
    id: { type: 'int', primary: true, generated: true },
    label: { type: 'text' },
  },
  relations: {
    item: { type: 'many-to-one', target: 'Item', inverseSide: 'tags', onDelete: 'CASCADE' },
  },
});

let container: StartedPostgreSqlContainer;
let dataSource: DataSource;
let items: Repository<ItemRow>;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  dataSource = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities: [ItemSchema, TagSchema],
    synchronize: true,
  });
  await dataSource.initialize();
  items = dataSource.getRepository(ItemSchema);
});

afterAll(async () => {
  await dataSource.destroy();
  await container.stop();
});

const toRow = (item: Item): ItemRow => ({
  ...item,
  d: item.d === null ? null : item.d.toString(),
  e: item.e === null ? null : item.e.toFixed(2),
});

const normalise = (row: ItemRow): Item => ({
  id: row.id,
  a: row.a,
  b: row.b,
  c: row.c,
  d: row.d === null ? null : BigInt(row.d),
  e: row.e === null ? null : Number(row.e),
});

// The suite types options on the normalised Item; TypeORM rows use strings for d and e.
// Field names are identical, which is all PaginateOptions depends on.
const asRowOptions = (options: PaginateOptions<Item>): PaginateOptions<ItemRow> =>
  options as unknown as PaginateOptions<ItemRow>;

const target: ConformanceTarget = {
  async reset(rows) {
    await dataSource.query('TRUNCATE item CASCADE');
    await this.insert(rows);
  },
  async insert(rows) {
    if (rows.length > 0) await items.insert(rows.map(toRow));
  },
  async paginate(options, filter) {
    const qb = items.createQueryBuilder('item');
    if (filter) qb.where('item.b = :b', { b: filter.b });
    const page = await paginateQueryBuilder(qb, 'item', asRowOptions(options));
    return { ...page, data: page.data.map(normalise) };
  },
};

runConformanceSuite('TypeORM + PostgreSQL', () => target);

describe('TypeORM specifics', () => {
  const byA: SortField<ItemRow>[] = [
    { field: 'a', direction: 'asc' },
    { field: 'id', direction: 'asc' },
  ];
  const row = (id: number, a: number, b: string): Item => ({ id, a, b, c: null, d: null, e: null });

  async function walk(qb: () => ReturnType<typeof items.createQueryBuilder>): Promise<number[]> {
    const seen: number[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const page: Page<ItemRow> = await paginateQueryBuilder(qb(), 'item', {
        sort: byA,
        limit: 2,
        after,
      });
      seen.push(...page.data.map((r) => r.id));
      if (!page.pageInfo.hasNextPage) return seen;
      after = page.pageInfo.endCursor;
    }
    throw new Error('walk did not terminate');
  }

  it('keeps OR conditions in the caller filter grouped (where().orWhere() and raw OR)', async () => {
    await target.reset([
      row(1, 1, 'x'),
      row(2, 2, 'y'),
      row(3, 3, 'z'),
      row(4, 4, 'x'),
      row(5, 5, 'y'),
    ]);
    const chained = () =>
      items
        .createQueryBuilder('item')
        .where('item.b = :x', { x: 'x' })
        .orWhere('item.b = :y', { y: 'y' });
    const raw = () => items.createQueryBuilder('item').where("item.b = 'x' OR item.b = 'y'");

    expect(await walk(chained)).toEqual([1, 2, 4, 5]);
    expect(await walk(raw)).toEqual([1, 2, 4, 5]);
  });

  it('limits by entity, not by joined row, when one-to-many relations are joined', async () => {
    await target.reset([row(1, 1, 'x'), row(2, 2, 'x'), row(3, 3, 'x')]);
    const tags = dataSource.getRepository(TagSchema);
    for (const id of [1, 2, 3]) {
      await tags.insert(['t1', 't2', 't3'].map((label) => ({ label, item: { id } as ItemRow })));
    }

    const page = await paginateQueryBuilder(
      items.createQueryBuilder('item').leftJoinAndSelect('item.tags', 'tag'),
      'item',
      { sort: byA, limit: 2 },
    );
    expect(page.data.map((r) => r.id)).toEqual([1, 2]);
    expect(page.data.every((r) => r.tags?.length === 3)).toBe(true);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it('does not modify the caller query builder', async () => {
    await target.reset([row(1, 1, 'x'), row(2, 2, 'x'), row(3, 3, 'x')]);
    const qb = items.createQueryBuilder('item').where('item.b = :b', { b: 'x' });
    const before = qb.getQuery();
    const first = await paginateQueryBuilder(qb, 'item', { sort: byA, limit: 1 });
    await paginateQueryBuilder(qb, 'item', {
      sort: byA,
      limit: 1,
      after: first.pageInfo.endCursor,
    });
    expect(qb.getQuery()).toBe(before);
  });

  it('rejects sort fields that are not entity columns, and unknown aliases', async () => {
    const qb = items.createQueryBuilder('item');
    const injected = [
      { field: 'a; DROP TABLE item', direction: 'asc' },
    ] as unknown as SortField<ItemRow>[];
    await expect(paginateQueryBuilder(qb, 'item', { sort: injected })).rejects.toThrow(
      /is not a column of Item/,
    );
    await expect(paginateQueryBuilder(qb, 'nope', { sort: byA })).rejects.toThrow(
      /"nope" is not an entity alias/,
    );
  });
});
