import { Inject, Injectable } from '@nestjs/common';
import type { Page } from 'keyset-kit';
import type { KeysetQuery } from 'keyset-kit/express';
import { paginateQueryBuilder } from 'keyset-kit/typeorm';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from './database.js';
import { Post } from './post.entity.js';

@Injectable()
export class PostsService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  list(keyset: KeysetQuery): Promise<Page<Post>> {
    const qb = this.dataSource.getRepository(Post).createQueryBuilder('post');
    return paginateQueryBuilder(qb, 'post', keyset);
  }
}
