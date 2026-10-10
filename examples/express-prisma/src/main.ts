import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';

createApp(prisma, config.cursorSecret).listen(config.port, () => {
  console.log(`express-prisma example listening on http://localhost:${String(config.port)}/posts`);
});
