ALTER TABLE `market` ADD `info_cursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market` ADD `reset_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market` ADD `reset_at` integer DEFAULT 0 NOT NULL;