import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaginateOptions } from '../../src/index.js';
import { paginatePrisma } from '../../src/prisma/index.js';
import { runConformanceSuite, type ConformanceTarget, type Item } from './conformance.js';
import { PrismaClient } from './prisma/generated/client.js';
import { POSTGRES_IMAGE } from './postgres.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
  });
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Item" (
      id integer PRIMARY KEY,
      a  integer,
      b  text,
      c  timestamp(3),
      d  bigint,
      e  numeric(10, 2)
    )`);
});

afterAll(async () => {
  await prisma.$disconnect();
  await container.stop();
});

type PrismaItem = Awaited<ReturnType<PrismaClient['item']['findMany']>>[number];

const normalise = (row: PrismaItem): Item => ({
  ...row,
  e: row.e === null ? null : row.e.toNumber(),
});

const target: ConformanceTarget = {
  async reset(rows) {
    await prisma.item.deleteMany();
    await this.insert(rows);
  },
  async insert(rows) {
    if (rows.length > 0) await prisma.item.createMany({ data: [...rows] });
  },
  async paginate(options, filter) {
    // The suite types options on the normalised Item (e: number); Prisma rows carry e: Decimal.
    // Both have the same field names, which is all PaginateOptions depends on.
    const prismaOptions = options as unknown as PaginateOptions<PrismaItem>;
    const page = await paginatePrisma(
      prisma.item,
      filter ? { where: { b: filter.b } } : {},
      prismaOptions,
    );
    return { ...page, data: page.data.map(normalise) };
  },
};

runConformanceSuite('Prisma + PostgreSQL', () => target);

describe('Prisma specifics', () => {
  it('infers the row type from the delegate and works with select', async () => {
    await target.reset([{ id: 1, a: 1, b: 'x', c: null, d: null, e: 1.5 }]);
    const page = await paginatePrisma(
      prisma.item,
      { select: { id: true, a: true } },
      {
        sort: [
          { field: 'a', direction: 'asc' },
          { field: 'id', direction: 'asc' },
        ],
      },
    );
    expect(page.data).toEqual([{ id: 1, a: 1 }]);
  });

  it('explains which field is missing when select omits a sort field', async () => {
    await target.reset([{ id: 1, a: 1, b: 'x', c: null, d: null, e: null }]);
    await expect(
      paginatePrisma(
        prisma.item,
        { select: { id: true } },
        {
          sort: [
            { field: 'a', direction: 'asc' },
            { field: 'id', direction: 'asc' },
          ],
        },
      ),
    ).rejects.toThrow(/"a" is undefined; select every sort field/);
  });
});
