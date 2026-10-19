CREATE TABLE `community_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`stock_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `community_created` ON `community_posts` (`created`);--> statement-breakpoint
CREATE INDEX `community_user` ON `community_posts` (`user_id`);--> statement-breakpoint
CREATE TABLE `research_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_key` text NOT NULL,
	`cost` integer NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_purchase_user` ON `research_purchases` (`user_id`);--> statement-breakpoint
CREATE TABLE `research_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_id` text NOT NULL,
	`news_id` text,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_created` ON `research_reports` (`created`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `tutorial_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `market` ADD `info_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX research_purchase_key ON research_purchases(user_id,request_key);
--> statement-breakpoint
CREATE TRIGGER research_purchase_validate BEFORE INSERT ON research_purchases BEGIN
 SELECT CASE WHEN NEW.cost!=30000 OR NEW.expires!=NEW.created+86400000 THEN RAISE(ABORT,'INVALID_SUBSCRIPTION') END;
 SELECT CASE WHEN COALESCE((SELECT expires FROM subscriptions WHERE user_id=NEW.user_id),0)>NEW.created THEN RAISE(ABORT,'SUBSCRIPTION_ACTIVE') END;
 SELECT CASE WHEN COALESCE((SELECT cash FROM accounts WHERE id=NEW.user_id),0)<NEW.cost THEN RAISE(ABORT,'SUBSCRIPTION_FUNDS') END;
END;
--> statement-breakpoint
CREATE TRIGGER research_purchase_apply AFTER INSERT ON research_purchases BEGIN
 UPDATE accounts SET cash=cash-NEW.cost WHERE id=NEW.user_id;
 INSERT INTO subscriptions(user_id,expires,updated) VALUES(NEW.user_id,NEW.expires,NEW.created) ON CONFLICT(user_id) DO UPDATE SET expires=NEW.expires,updated=NEW.created;
 INSERT INTO cash_events(id,user_id,stock_id,kind,amount,due_at,settled,created) VALUES('research-'||NEW.id,NEW.user_id,NULL,'리서치 구독료',-NEW.cost,NEW.created,1,NEW.created);
END;
