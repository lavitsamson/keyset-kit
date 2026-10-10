import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('post')
// Matches the default sort, so each page is an index range scan.
@Index('post_created_at_id_idx', ['createdAt', 'id'])
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  title: string;

  // timestamp(3): millisecond precision, matching JavaScript Dates in cursors.
  @Column({ type: 'timestamp', precision: 3, name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'int', nullable: true })
  score: number | null;
}
