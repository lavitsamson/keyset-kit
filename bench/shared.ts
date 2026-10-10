import { DataSource, EntitySchema, type Logger } from 'typeorm';

/** Rows in the benchmark table. */
export const ROWS = 1_000_000;

export const CONNECTION = {
  host: process.env['BENCH_PG_HOST'] ?? 'localhost',
  port: Number(process.env['BENCH_PG_PORT'] ?? 5434),
  user: 'bench',
  password: 'bench',
  database: 'bench',
};

export interface Post {
  id: number;
  authorId: number;
  title: string;
  body: string;
  createdAt: Date;
}

export const PostEntity = new EntitySchema<Post>({
  name: 'Post',
  tableName: 'posts',
  columns: {
    id: { type: 'int', primary: true, generated: true },
    authorId: { type: 'int', name: 'author_id' },
    title: { type: 'text' },
    body: { type: 'text' },
    createdAt: { type: 'timestamptz', precision: 3, name: 'created_at' },
  },
});

export interface CapturedQuery {
  query: string;
  parameters: unknown[];
}

/** Records the last SQL statement TypeORM sends during `capture`, so it can be run under EXPLAIN. */
export class CapturingLogger implements Logger {
  private captured: CapturedQuery[] | undefined;

  async capture(run: () => Promise<unknown>): Promise<CapturedQuery> {
    const captured: CapturedQuery[] = [];
    this.captured = captured;
    try {
      await run();
    } finally {
      this.captured = undefined;
    }
    const last = captured.at(-1);
    if (!last) throw new Error('No query was captured.');
    return last;
  }

  logQuery(query: string, parameters?: unknown[] | object): void {
    this.captured?.push({ query, parameters: Array.isArray(parameters) ? parameters : [] });
  }
  logQueryError(): void {
    // Errors surface as rejected promises.
  }
  logQuerySlow(): void {
    // Not needed.
  }
  logSchemaBuild(): void {
    // Not needed.
  }
  logMigration(): void {
    // Not needed.
  }
  log(): void {
    // Not needed.
  }
}

export function createDataSource(logger?: Logger): DataSource {
  return new DataSource({
    type: 'postgres',
    ...CONNECTION,
    username: CONNECTION.user,
    entities: [PostEntity],
    ...(logger ? { logger } : {}),
  });
}
