export const config = {
  mongoUrl: process.env.MONGODB_URL ?? 'mongodb://localhost:27018/keyset',
  port: Number(process.env.PORT ?? 3000),
  // Use a long random value from your secret store in production.
  cursorSecret: process.env.CURSOR_SECRET ?? 'dev-only-cursor-secret',
};
