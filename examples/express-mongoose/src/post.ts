import { model, Schema } from 'mongoose';

export interface Post {
  title: string;
  createdAt: Date;
  score?: number | null;
}

const postSchema = new Schema<Post>(
  {
    title: { type: String, required: true },
    createdAt: { type: Date, required: true },
    score: Number,
  },
  { versionKey: false },
);

// Compound index matching the default sort, so each page is an index range scan.
postSchema.index({ createdAt: -1, _id: 1 });

export const PostModel = model<Post>('Post', postSchema);
