import { relations, sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { TRACK_VISIBILITIES } from '../../types';

const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
};

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		username: text('username').notNull(),
		passwordHash: text('password_hash').notNull(),
		...timestamps
	},
	(table) => [
		uniqueIndex('users_email_unique').on(table.email),
		uniqueIndex('users_username_unique').on(table.username)
	]
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		tokenHash: text('token_hash').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [
		uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
		index('sessions_user_id_idx').on(table.userId),
		index('sessions_expires_at_idx').on(table.expiresAt)
	]
);

export const tracks = sqliteTable(
	'tracks',
	{
		id: text('id').primaryKey(),
		ownerId: text('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
		title: text('title').notNull(),
		artist: text('artist').notNull(),
		bpm: integer('bpm'),
		musicalKey: text('musical_key'),
		genre: text('genre'),
		description: text('description'),
		originalFilename: text('original_filename').notNull(),
		storageKey: text('storage_key').notNull(),
		mimeType: text('mime_type').notNull(),
		fileSizeBytes: integer('file_size_bytes').notNull(),
		durationMs: integer('duration_ms'),
		visibility: text('visibility', { enum: TRACK_VISIBILITIES }).notNull().default('public'),
		...timestamps
	},
	(table) => [
		uniqueIndex('tracks_storage_key_unique').on(table.storageKey),
		index('tracks_owner_created_at_idx').on(table.ownerId, table.createdAt),
		index('tracks_created_at_idx').on(table.createdAt),
		check('tracks_file_size_positive', sql`${table.fileSizeBytes} > 0`),
		check(
			'tracks_duration_non_negative',
			sql`${table.durationMs} is null or ${table.durationMs} >= 0`
		),
		check('tracks_bpm_valid', sql`${table.bpm} is null or ${table.bpm} between 20 and 300`),
		check('tracks_visibility_valid', sql`${table.visibility} in ('private', 'public')`)
	]
);

export const usersRelations = relations(users, ({ many }) => ({
	sessions: many(sessions),
	tracks: many(tracks)
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	})
}));

export const tracksRelations = relations(tracks, ({ one }) => ({
	owner: one(users, {
		fields: [tracks.ownerId],
		references: [users.id]
	})
}));
