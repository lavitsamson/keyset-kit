import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';

await mongoose.connect(config.mongoUrl);
createApp(config.cursorSecret).listen(config.port, () => {
  console.log(
    `express-mongoose example listening on http://localhost:${String(config.port)}/posts`,
  );
});
