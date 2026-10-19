CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`cash` integer DEFAULT 10000000 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`realized` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candles` (
	`stock_id` text NOT NULL,
	`ts` integer NOT NULL,
	`open` integer NOT NULL,
	`high` integer NOT NULL,
	`low` integer NOT NULL,
	`close` integer NOT NULL,
	`volume` integer NOT NULL,
	PRIMARY KEY(`stock_id`, `ts`),
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`user_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`cost` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `stock_id`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `market` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_tick` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `news` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`stock_id` text,
	`sector` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`impact` real NOT NULL,
	`expires` integer NOT NULL,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`side` text NOT NULL,
	`kind` text NOT NULL,
	`qty` integer NOT NULL,
	`limit_price` integer NOT NULL,
	`reserve_cash` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`fill_price` integer,
	`fee` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`filled_at` integer,
	`request_key` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_queue` ON `orders` (`status`,`created`);--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`user_id`,`created`);--> statement-breakpoint
CREATE TABLE `stocks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`kind` text NOT NULL,
	`initial` integer NOT NULL,
	`price` integer NOT NULL,
	`previous` integer NOT NULL,
	`day_open` integer NOT NULL,
	`high` integer NOT NULL,
	`low` integer NOT NULL,
	`volume` integer DEFAULT 0 NOT NULL,
	`turnover` integer DEFAULT 0 NOT NULL,
	`shares` integer NOT NULL,
	`pe` real NOT NULL,
	`dividend` real NOT NULL,
	`beta` real NOT NULL,
	`net_flow` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticks` (
	`ts` integer PRIMARY KEY NOT NULL,
	`index_value` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`user_id` text NOT NULL,
	`stock_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `stock_id`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`) REFERENCES `stocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX orders_idempotent ON orders(user_id,request_key);
--> statement-breakpoint
CREATE TRIGGER revision_guard BEFORE UPDATE ON market WHEN NEW.revision<0 BEGIN SELECT RAISE(ABORT,'STALE_MARKET'); END;
--> statement-breakpoint
CREATE TRIGGER order_validate BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NEW.qty<1 OR NEW.qty>2000 OR NEW.qty!=CAST(NEW.qty AS INTEGER) OR NEW.side NOT IN ('buy','sell') OR NEW.kind NOT IN ('market','limit') OR NEW.status!='open' OR NEW.limit_price<1 THEN RAISE(ABORT,'INVALID_ORDER') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM orders WHERE user_id=NEW.user_id AND status='open')>=30 THEN RAISE(ABORT,'ORDER_LIMIT') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM orders WHERE user_id=NEW.user_id AND created>NEW.created-60000)>=12 THEN RAISE(ABORT,'RATE_LIMIT') END;
 SELECT CASE WHEN NEW.side='buy' AND (SELECT cash FROM accounts WHERE id=NEW.user_id)<NEW.reserve_cash THEN RAISE(ABORT,'INSUFFICIENT_CASH') END;
 SELECT CASE WHEN NEW.side='sell' AND COALESCE((SELECT qty-reserved FROM holdings WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id),0)<NEW.qty THEN RAISE(ABORT,'INSUFFICIENT_SHARES') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_reserve AFTER INSERT ON orders BEGIN
 UPDATE accounts SET cash=cash-NEW.reserve_cash,reserved=reserved+NEW.reserve_cash WHERE id=NEW.user_id AND NEW.side='buy';
 UPDATE holdings SET reserved=reserved+NEW.qty WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id AND NEW.side='sell';
 UPDATE market SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER order_transition BEFORE UPDATE ON orders WHEN OLD.status!='open' OR NEW.status NOT IN ('filled','cancelled','expired') BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
--> statement-breakpoint
CREATE TRIGGER order_filled_buy AFTER UPDATE ON orders WHEN NEW.status='filled' AND NEW.side='buy' BEGIN
 SELECT CASE WHEN NEW.fill_price>OLD.limit_price OR NEW.fill_price<1 OR NEW.fill_price IS NULL OR NEW.fee!=CAST((NEW.fill_price*NEW.qty+999)/1000 AS INTEGER) THEN RAISE(ABORT,'INVALID_FILL') END;
 UPDATE accounts SET cash=cash+OLD.reserve_cash-NEW.fill_price*NEW.qty-NEW.fee,reserved=reserved-OLD.reserve_cash WHERE id=NEW.user_id;
 INSERT INTO holdings(user_id,stock_id,qty,reserved,cost) VALUES(NEW.user_id,NEW.stock_id,NEW.qty,0,NEW.fill_price*NEW.qty+NEW.fee) ON CONFLICT(user_id,stock_id) DO UPDATE SET qty=qty+NEW.qty,cost=cost+NEW.fill_price*NEW.qty+NEW.fee;
 UPDATE market SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER order_filled_sell AFTER UPDATE ON orders WHEN NEW.status='filled' AND NEW.side='sell' BEGIN
 SELECT CASE WHEN NEW.fill_price<OLD.limit_price OR NEW.fill_price<1 OR NEW.fill_price IS NULL OR NEW.fee!=CAST((NEW.fill_price*NEW.qty+999)/1000 AS INTEGER) THEN RAISE(ABORT,'INVALID_FILL') END;
 UPDATE accounts SET cash=cash+NEW.fill_price*NEW.qty-NEW.fee,realized=realized+NEW.fill_price*NEW.qty-NEW.fee-CAST((SELECT cost*NEW.qty/qty FROM holdings WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id) AS INTEGER) WHERE id=NEW.user_id;
 UPDATE holdings SET cost=cost-CAST(cost*NEW.qty/qty AS INTEGER),qty=qty-NEW.qty,reserved=reserved-NEW.qty WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id;
 UPDATE market SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER order_release AFTER UPDATE ON orders WHEN NEW.status IN ('cancelled','expired') BEGIN
 UPDATE accounts SET cash=cash+OLD.reserve_cash,reserved=reserved-OLD.reserve_cash WHERE id=NEW.user_id AND NEW.side='buy';
 UPDATE holdings SET reserved=reserved-NEW.qty WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id AND NEW.side='sell';
 UPDATE market SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER account_guard BEFORE UPDATE ON accounts WHEN NEW.cash<0 OR NEW.reserved<0 BEGIN SELECT RAISE(ABORT,'ACCOUNT_INVARIANT'); END;
--> statement-breakpoint
CREATE TRIGGER holding_guard BEFORE UPDATE ON holdings WHEN NEW.qty<0 OR NEW.reserved<0 OR NEW.reserved>NEW.qty OR NEW.cost<0 BEGIN SELECT RAISE(ABORT,'HOLDING_INVARIANT'); END;
