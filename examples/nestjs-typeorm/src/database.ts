import { DataSource } from 'typeorm';
import { config } from './config.js';
import { Post } from './post.entity.js';

export const DATA_SOURCE = Symbol('DATA_SOURCE');

export function createDataSource(options: { synchronize: boolean }): DataSource {
  return new DataSource({
    type: 'postgres',
    url: config.databaseUrl,
    entities: [Post],
    synchronize: options.synchronize,
  });
}
