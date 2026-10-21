ALTER TABLE `market` ADD `fundamentals_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `financial_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `financial_fx` real DEFAULT 1340 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `financial_oil` real DEFAULT 78 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `financial_rate` real DEFAULT 3 NOT NULL;