import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { sessions, tracks, users } from './schema';

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type PublicUser = Pick<User, 'id' | 'username' | 'createdAt'>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type Track = InferSelectModel<typeof tracks>;
export type NewTrack = InferInsertModel<typeof tracks>;
export type PublicTrack = Omit<Track, 'storageKey'>;
