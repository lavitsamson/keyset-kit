import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Page } from 'keyset-kit';
import { setLinkHeader } from 'keyset-kit/express';
import type { Post } from './post.entity.js';
import { PostsService } from './posts.service.js';

@Controller('posts')
export class PostsController {
  constructor(@Inject(PostsService) private readonly posts: PostsService) {}

  // GET /posts?limit=20&sort=-createdAt&after=<cursor>
  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Page<Post>> {
    const page = await this.posts.list(req.keyset);
    setLinkHeader(res, req, page.pageInfo);
    return page;
  }
}
