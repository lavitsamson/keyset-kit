import { model, Schema } from 'mongoose';
import type { Request } from 'express';
import { assertType, describe, expectTypeOf, it } from 'vitest';
import { keysetParams } from '../../src/express/index.js';
import type { AnySortField, Page, ParsedSort } from '../../src/index.js';
import { paginateMongoose } from '../../src/mongoose/index.js';
import { paginatePrisma, type PrismaDelegate } from '../../src/prisma/index.js';

interface Post {
  title: string;
  createdAt: Date;
}
const Post = model<Post>('TypeTestPost', new Schema<Post>({ title: String, createdAt: Date }));
const sort = [
  { field: 'createdAt', direction: 'desc' },
  { field: '_id', direction: 'asc' },
] as const;

describe('paginateMongoose types', () => {
  it('accepts lean and hydrated queries and infers the row type', async () => {
    const lean = await paginateMongoose(Post.find().lean(), { sort });
    expectTypeOf(lean.data[0]?.title).toEqualTypeOf<string | undefined>();

    const hydrated = await paginateMongoose(Post.find({ title: 'x' }), { sort });
    expectTypeOf(hydrated.data[0]?.createdAt).toEqualTypeOf<Date | undefined>();
  });

  it('rejects sort fields that are not on the document', () => {
    // @ts-expect-error - 'missing' is not a field of Post
    void paginateMongoose(Post.find().lean(), { sort: [{ field: 'missing', direction: 'asc' }] });
  });
});

describe('Express middleware types', () => {
  interface Article {
    id: number;
    title: string;
  }

  it('lets req.keyset be passed straight to an adapter typed on any model', () => {
    const delegate: PrismaDelegate<Article> = { findMany: () => Promise.resolve([]) };
    const handler = (req: Request) => paginatePrisma(delegate, {}, req.keyset);
    expectTypeOf(handler).returns.resolves.toEqualTypeOf<Page<Article>>();
  });

  it('keeps hand-written sorts type-checked: a plain array is not a ParsedSort', () => {
    const plain: readonly AnySortField[] = [{ field: 'nope', direction: 'asc' }];
    // @ts-expect-error - only keysetParams() produces a ParsedSort
    assertType<ParsedSort>(plain);
  });

  it('checks allowedSort and defaultSort against the model when one is given', () => {
    keysetParams<Article>({
      // @ts-expect-error - 'body' is not a field of Article
      allowedSort: ['title', 'body'],
      defaultSort: [{ field: 'id', direction: 'asc' }],
    });
  });
});
