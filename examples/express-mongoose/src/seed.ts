import mongoose from 'mongoose';
import { config } from './config.js';
import { PostModel } from './post.js';

await mongoose.connect(config.mongoUrl);
await PostModel.deleteMany({});
await PostModel.syncIndexes();

const start = Date.UTC(2026, 0, 1);
await PostModel.insertMany(
  Array.from({ length: 200 }, (_, i) => ({
    title: `Post ${String(i + 1)}`,
    // Every 10 posts share a timestamp, so the _id tie-breaker matters.
    createdAt: new Date(start + Math.floor(i / 10) * 3_600_000),
    // Some posts have no score at all: MongoDB sorts missing like null.
    ...(i % 7 === 0 ? {} : { score: i % 50 }),
  })),
);

console.log('Seeded 200 posts.');
await mongoose.disconnect();
