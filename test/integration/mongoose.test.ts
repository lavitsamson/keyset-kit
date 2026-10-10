import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { Schema, type Connection, type Model, type Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, PaginateOptions, SortField } from '../../src/index.js';
import { paginateMongoose } from '../../src/mongoose/index.js';
import { runConformanceSuite, type ConformanceTarget, type Item } from './conformance.js';

/** Pinned so integration results are reproducible. */
const MONGO_IMAGE = 'mongo:8.3.9';

interface ItemDoc {
  id: number;
  a: number | null;
  b: string | null;
  c: Date | null;
  d: bigint | null;
  e: Types.Decimal128 | null;
}

const itemSchema = new Schema<ItemDoc>(
  {
    id: { type: Number, required: true, unique: true },
    a: Number,
    b: String,
    c: Date,
    d: BigInt,
    e: Schema.Types.Decimal128,
  },
  { versionKey: false },
);

let container: StartedMongoDBContainer;
let connection: Connection;
let Items: Model<ItemDoc>;

beforeAll(async () => {
  container = await new MongoDBContainer(MONGO_IMAGE).start();
  connection = await mongoose
    .createConnection(`${container.getConnectionString()}?directConnection=true`)
    .asPromise();
  Items = connection.model('Item', itemSchema);
  await Items.init();
});

afterAll(async () => {
  await connection.close();
  await container.stop();
});

const toDoc = (item: Item) => ({
  ...item,
  e: item.e === null ? null : mongoose.Types.Decimal128.fromString(item.e.toFixed(2)),
});

const normalise = (doc: ItemDoc): Item => ({
  id: doc.id,
  a: doc.a ?? null,
  b: doc.b ?? null,
  c: doc.c ?? null,
  d: doc.d ?? null,
  e: doc.e == null ? null : Number(doc.e.toString()),
});

// The suite types options on the normalised Item; documents carry e as Decimal128.
// Field names are identical, which is all PaginateOptions depends on.
const asDocOptions = (options: PaginateOptions<Item>): PaginateOptions<ItemDoc> =>
  options as unknown as PaginateOptions<ItemDoc>;

const target: ConformanceTarget = {
  fixedNullOrder: 'smallest',
  async reset(rows) {
    await Items.deleteMany({});
    await this.insert(rows);
  },
  async insert(rows) {
    if (rows.length > 0) await Items.insertMany(rows.map(toDoc));
  },
  async paginate(options, filter) {
    const page = await paginateMongoose(
      Items.find(filter ? { b: filter.b } : {}),
      asDocOptions(options),
    );
    return { ...page, data: page.data.map(normalise) };
  },
};

runConformanceSuite('Mongoose + MongoDB', () => target);

describe('Mongoose specifics', () => {
  const row = (id: number, a: number | null, b: string): Item => ({
    id,
    a,
    b,
    c: null,
    d: null,
    e: null,
  });

  async function walk<T>(
    query: () => Parameters<typeof paginateMongoose<T>>[0],
    sort: SortField<T>[],
  ): Promise<T[]> {
    const seen: T[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const page: Page<T> = await paginateMongoose(query(), { sort, limit: 2, after });
      seen.push(...page.data);
      if (!page.pageInfo.hasNextPage) return seen;
      after = page.pageInfo.endCursor;
    }
    throw new Error('walk did not terminate');
  }

  it('paginates lean queries with an ObjectId tie-breaker', async () => {
    await target.reset([
      row(1, 2, 'x'),
      row(2, 1, 'x'),
      row(3, 2, 'x'),
      row(4, 1, 'x'),
      row(5, 2, 'x'),
    ]);
    const expected = await Items.find().sort({ a: 1, _id: 1 }).lean();
    const walked = await walk(
      () => Items.find().lean(),
      [
        { field: 'a', direction: 'asc' },
        { field: '_id', direction: 'asc' },
      ],
    );
    expect(walked.map((d) => String(d._id))).toEqual(expected.map((d) => String(d._id)));
  });

  it('treats missing fields like null, matching MongoDB sort order', async () => {
    await Items.deleteMany({});
    await Items.collection.insertMany([
      { id: 1, a: 5 },
      { id: 2 },
      { id: 3, a: null },
      { id: 4, a: 1 },
    ]);
    const walked = await walk(
      () => Items.find(),
      [
        { field: 'a', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
    );
    expect(walked.map((d) => d.id)).toEqual([2, 3, 4, 1]);
  });

  it('combines a caller $or filter with the keyset condition', async () => {
    await target.reset([
      row(1, 1, 'x'),
      row(2, 2, 'y'),
      row(3, 3, 'z'),
      row(4, 4, 'x'),
      row(5, 5, 'y'),
    ]);
    const walked = await walk(
      () => Items.find({ $or: [{ b: 'x' }, { b: 'y' }] }),
      [
        { field: 'a', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
    );
    expect(walked.map((d) => d.id)).toEqual([1, 2, 4, 5]);
  });

  it('does not modify the caller query', async () => {
    await target.reset([row(1, 1, 'x'), row(2, 2, 'x'), row(3, 3, 'x')]);
    const query = Items.find({ b: 'x' }).sort({ b: -1 });
    const filter = JSON.stringify(query.getFilter());
    const sort = JSON.stringify(query.getOptions().sort);
    const sortSpec: SortField<ItemDoc>[] = [{ field: 'id', direction: 'asc' }];
    const first = await paginateMongoose(query, { sort: sortSpec, limit: 1 });
    await paginateMongoose(query, { sort: sortSpec, limit: 1, after: first.pageInfo.endCursor });
    expect(JSON.stringify(query.getFilter())).toBe(filter);
    expect(JSON.stringify(query.getOptions().sort)).toBe(sort);
  });

  it('works with a projection that keeps the sort fields and rejects one that drops them', async () => {
    await target.reset([row(1, 2, 'x'), row(2, 1, 'y'), row(3, 3, 'z')]);
    const sort: SortField<ItemDoc>[] = [
      { field: 'a', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];
    const page = await paginateMongoose(Items.find().select('a id -_id').lean(), { sort });
    expect(page.data).toEqual([
      { a: 1, id: 2 },
      { a: 2, id: 1 },
      { a: 3, id: 3 },
    ]);
    await expect(paginateMongoose(Items.find().select('id'), { sort })).rejects.toThrow(
      /sort field "a" is excluded by the query projection/,
    );
  });

  it('rejects nulls options MongoDB cannot honour, and fields outside the schema', async () => {
    await expect(
      paginateMongoose(Items.find(), {
        sort: [
          { field: 'a', direction: 'asc', nulls: 'last' },
          { field: 'id', direction: 'asc' },
        ],
      }),
    ).rejects.toThrow(/MongoDB always sorts nulls first for 'asc'/);

    const operator = [{ field: '$where', direction: 'asc' }] as unknown as SortField<ItemDoc>[];
    await expect(paginateMongoose(Items.find(), { sort: operator })).rejects.toThrow(
      /"\$where" is not a path in the model's schema/,
    );
  });
});
