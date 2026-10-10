import { model, Schema } from 'mongoose';
import { describe, expectTypeOf, it } from 'vitest';
import { paginateMongoose } from '../../src/mongoose/index.js';

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
