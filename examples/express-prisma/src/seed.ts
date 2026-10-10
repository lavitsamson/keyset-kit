// Creates the table and inserts 200 posts. Real projects would use `prisma migrate`; this example
// uses SQL so it runs without Prisma's migration engine.
import { prisma } from './db.js';

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "Post" (
    "id"        serial PRIMARY KEY,
    "title"     text NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT now(),
    "score"     integer
  )`);
await prisma.$executeRawUnsafe(
  `CREATE INDEX IF NOT EXISTS "Post_createdAt_id_idx" ON "Post" ("createdAt" DESC, "id")`,
);
await prisma.$executeRawUnsafe(`TRUNCATE "Post" RESTART IDENTITY`);

const start = Date.UTC(2026, 0, 1);
await prisma.post.createMany({
  data: Array.from({ length: 200 }, (_, i) => ({
    title: `Post ${String(i + 1)}`,
    // Every 10 posts share a timestamp, so the id tie-breaker matters.
    createdAt: new Date(start + Math.floor(i / 10) * 3_600_000),
    score: i % 7 === 0 ? null : i % 50,
  })),
});

console.log('Seeded 200 posts.');
await prisma.$disconnect();
