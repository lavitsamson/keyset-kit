export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://keyset:keyset@localhost:5433/keyset',
  port: Number(process.env.PORT ?? 3000),
  // Use a long random value from your secret store in production.
  cursorSecret: process.env.CURSOR_SECRET ?? 'dev-only-cursor-secret',
};
