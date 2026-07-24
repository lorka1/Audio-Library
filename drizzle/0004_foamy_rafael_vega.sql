PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tracks` (
	`public_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`bpm` integer,
	`musical_key` text,
	`genre` text,
	`description` text,
	`original_filename` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`duration_ms` integer,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "tracks_file_size_positive" CHECK("__new_tracks"."file_size_bytes" > 0),
	CONSTRAINT "tracks_duration_non_negative" CHECK("__new_tracks"."duration_ms" is null or "__new_tracks"."duration_ms" >= 0),
	CONSTRAINT "tracks_bpm_valid" CHECK("__new_tracks"."bpm" is null or "__new_tracks"."bpm" between 20 and 300),
	CONSTRAINT "tracks_visibility_valid" CHECK("__new_tracks"."visibility" in ('private', 'public'))
);
--> statement-breakpoint
INSERT INTO `__new_tracks`("id", "owner_id", "title", "artist", "bpm", "musical_key", "genre", "description", "original_filename", "storage_key", "mime_type", "file_size_bytes", "duration_ms", "visibility", "created_at", "updated_at") SELECT "id", "owner_id", "title", "artist", "bpm", "musical_key", "genre", "description", "original_filename", "storage_key", "mime_type", "file_size_bytes", "duration_ms", "visibility", "created_at", "updated_at" FROM `tracks`;--> statement-breakpoint
DROP TABLE `tracks`;--> statement-breakpoint
ALTER TABLE `__new_tracks` RENAME TO `tracks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_id_unique` ON `tracks` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_storage_key_unique` ON `tracks` (`storage_key`);--> statement-breakpoint
CREATE INDEX `tracks_owner_created_at_idx` ON `tracks` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tracks_created_at_idx` ON `tracks` (`created_at`);
