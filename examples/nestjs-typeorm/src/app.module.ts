import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { keysetParams } from 'keyset-kit/express';
import { config } from './config.js';
import { createDataSource, DATA_SOURCE } from './database.js';
import type { Post } from './post.entity.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    {
      provide: DATA_SOURCE,
      useFactory: () => createDataSource({ synchronize: false }).initialize(),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // keysetParams is plain Express middleware, so Nest can apply it to routes directly.
    consumer
      .apply(
        keysetParams<Post>({
          allowedSort: ['createdAt', 'title', 'score'],
          defaultSort: [
            { field: 'createdAt', direction: 'desc' },
            { field: 'id', direction: 'asc' },
          ],
          maxLimit: 100,
          secret: config.cursorSecret,
        }),
      )
      .forRoutes(PostsController);
  }
}
