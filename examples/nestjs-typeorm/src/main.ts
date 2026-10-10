import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
await app.listen(config.port);
console.log(`nestjs-typeorm example listening on http://localhost:${String(config.port)}/posts`);
