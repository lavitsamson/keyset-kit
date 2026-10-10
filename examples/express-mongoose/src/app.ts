import express, { type ErrorRequestHandler } from 'express';
import { keysetParams, setLinkHeader } from 'keyset-kit/express';
import { paginateMongoose } from 'keyset-kit/mongoose';
import { PostModel, type Post } from './post.js';

export function createApp(cursorSecret: string): express.Express {
  const app = express();

  // GET /posts?limit=20&sort=-createdAt&after=<cursor>
  app.get(
    '/posts',
    keysetParams<Post & { _id: unknown }>({
      allowedSort: ['createdAt', 'title', 'score'],
      // MongoDB's natural tie-breaker is the unique _id.
      defaultSort: [
        // Required column: no IS NULL branches, so every page (and ?sort=createdAt) uses the index.
        { field: 'createdAt', direction: 'desc', nullable: false },
        { field: '_id', direction: 'asc' },
      ],
      maxLimit: 100,
      secret: cursorSecret,
    }),
    async (req, res) => {
      const page = await paginateMongoose(PostModel.find().lean(), req.keyset);
      setLinkHeader(res, req, page.pageInfo);
      res.json(page);
    },
  );

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    res.status(500).type('application/problem+json').json({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
  };
  app.use(onError);

  return app;
}
