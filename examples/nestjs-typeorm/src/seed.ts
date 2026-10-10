// Creates the table (TypeORM synchronize, fine for an example) and inserts 200 posts.
import 'reflect-metadata';
import { createDataSource } from './database.js';
import { Post } from './post.entity.js';

const dataSource = await createDataSource({ synchronize: true }).initialize();
await dataSource.query('TRUNCATE post RESTART IDENTITY');

const start = Date.UTC(2026, 0, 1);
await dataSource.getRepository(Post).insert(
  Array.from({ length: 200 }, (_, i) => ({
    title: `Post ${String(i + 1)}`,
    // Every 10 posts share a timestamp, so the id tie-breaker matters.
    createdAt: new Date(start + Math.floor(i / 10) * 3_600_000),
    score: i % 7 === 0 ? null : i % 50,
  })),
);

console.log('Seeded 200 posts.');
await dataSource.destroy();
