CREATE TABLE `auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cash_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stock_id` text,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`due_at` integer NOT NULL,
	`settled` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_due` ON `cash_events` (`settled`,`due_at`);--> statement-breakpoint
CREATE INDEX `cash_user` ON `cash_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`password_hash` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_login_unique` ON `credentials` (`login`);--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fills_order` ON `fills` (`order_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `sessions` (`expires`);--> statement-breakpoint
ALTER TABLE `market` ADD `catalog_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `news` ADD `details` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `filled_qty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `fill_value` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `company_type` text DEFAULT '보통주' NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `eps` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `bps` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `revenue` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `margin` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `debt_ratio` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `export_ratio` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `nav` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `annual_fee` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stocks` ADD `payout` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticks` ADD `rate` real DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticks` ADD `fx` real DEFAULT 1340 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticks` ADD `oil` real DEFAULT 78 NOT NULL;--> statement-breakpoint
ALTER TABLE `ticks` ADD `gold` real DEFAULT 2700 NOT NULL;--> statement-breakpoint
DROP TRIGGER order_filled_buy;
--> statement-breakpoint
DROP TRIGGER order_filled_sell;
--> statement-breakpoint
DROP TRIGGER order_transition;
--> statement-breakpoint
DROP TRIGGER order_release;
--> statement-breakpoint
DROP TRIGGER order_validate;
--> statement-breakpoint
CREATE TRIGGER order_validate BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NEW.qty<1 OR NEW.qty>2000 OR NEW.qty!=CAST(NEW.qty AS INTEGER) OR NEW.side NOT IN ('buy','sell') OR NEW.kind NOT IN ('market','limit') OR NEW.status!='open' OR NEW.limit_price<1 OR NEW.filled_qty!=0 OR COALESCE((SELECT active FROM stocks WHERE id=NEW.stock_id),0)!=1 THEN RAISE(ABORT,'INVALID_ORDER') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM orders WHERE user_id=NEW.user_id AND status IN ('open','partial'))>=30 THEN RAISE(ABORT,'ORDER_LIMIT') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM orders WHERE user_id=NEW.user_id AND created>NEW.created-60000)>=12 THEN RAISE(ABORT,'RATE_LIMIT') END;
 SELECT CASE WHEN NEW.side='buy' AND ((SELECT cash FROM accounts WHERE id=NEW.user_id)<NEW.reserve_cash OR NEW.reserve_cash!=NEW.qty*(NEW.limit_price+CAST((NEW.limit_price+999)/1000 AS INTEGER))) THEN RAISE(ABORT,'INSUFFICIENT_CASH') END;
 SELECT CASE WHEN NEW.side='sell' AND COALESCE((SELECT qty-reserved FROM holdings WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id),0)<NEW.qty THEN RAISE(ABORT,'INSUFFICIENT_SHARES') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_transition BEFORE UPDATE ON orders WHEN OLD.status NOT IN ('open','partial') OR NEW.status NOT IN ('partial','filled','cancelled','expired') OR NEW.filled_qty<OLD.filled_qty OR NEW.filled_qty>NEW.qty BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
--> statement-breakpoint
CREATE TRIGGER order_release AFTER UPDATE ON orders WHEN NEW.status IN ('cancelled','expired') BEGIN
 UPDATE accounts SET cash=cash+OLD.reserve_cash,reserved=reserved-OLD.reserve_cash WHERE id=NEW.user_id AND NEW.side='buy';
 UPDATE holdings SET reserved=reserved-(OLD.qty-OLD.filled_qty) WHERE user_id=NEW.user_id AND stock_id=NEW.stock_id AND NEW.side='sell';
 UPDATE market SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER fill_validate BEFORE INSERT ON fills BEGIN
 SELECT CASE WHEN NEW.qty<1 OR NEW.qty!=CAST(NEW.qty AS INTEGER) OR NEW.price<1 OR NEW.fee!=CAST((NEW.price*NEW.qty+999)/1000 AS INTEGER) THEN RAISE(ABORT,'INVALID_FILL') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status IN ('open','partial') AND qty-filled_qty>=NEW.qty AND ((side='buy' AND limit_price>=NEW.price AND reserve_cash>=NEW.qty*(limit_price+CAST((limit_price+999)/1000 AS INTEGER))) OR (side='sell' AND limit_price<=NEW.price))) THEN RAISE(ABORT,'INVALID_FILL') END;
END;
--> statement-breakpoint
CREATE TRIGGER fill_buy AFTER INSERT ON fills WHEN (SELECT side FROM orders WHERE id=NEW.order_id)='buy' BEGIN
 UPDATE accounts SET cash=cash+(SELECT NEW.qty*(limit_price+CAST((limit_price+999)/1000 AS INTEGER)) FROM orders WHERE id=NEW.order_id)-NEW.qty*NEW.price-NEW.fee,reserved=reserved-(SELECT NEW.qty*(limit_price+CAST((limit_price+999)/1000 AS INTEGER)) FROM orders WHERE id=NEW.order_id) WHERE id=(SELECT user_id FROM orders WHERE id=NEW.order_id);
 INSERT INTO holdings(user_id,stock_id,qty,reserved,cost) SELECT user_id,stock_id,NEW.qty,0,NEW.qty*NEW.price+NEW.fee FROM orders WHERE id=NEW.order_id ON CONFLICT(user_id,stock_id) DO UPDATE SET qty=qty+NEW.qty,cost=cost+NEW.qty*NEW.price+NEW.fee;
END;
--> statement-breakpoint
CREATE TRIGGER fill_sell AFTER INSERT ON fills WHEN (SELECT side FROM orders WHERE id=NEW.order_id)='sell' BEGIN
 UPDATE accounts SET cash=cash+NEW.qty*NEW.price-NEW.fee,realized=realized+NEW.qty*NEW.price-NEW.fee-CAST((SELECT h.cost*NEW.qty/h.qty FROM holdings h JOIN orders o ON o.user_id=h.user_id AND o.stock_id=h.stock_id WHERE o.id=NEW.order_id) AS INTEGER) WHERE id=(SELECT user_id FROM orders WHERE id=NEW.order_id);
 UPDATE holdings SET cost=cost-CAST(cost*NEW.qty/qty AS INTEGER),qty=qty-NEW.qty,reserved=reserved-NEW.qty WHERE (user_id,stock_id)=(SELECT user_id,stock_id FROM orders WHERE id=NEW.order_id);
END;
--> statement-breakpoint
CREATE TRIGGER fill_order AFTER INSERT ON fills BEGIN
 UPDATE orders SET filled_qty=filled_qty+NEW.qty,fill_value=fill_value+NEW.qty*NEW.price,fill_price=CAST((fill_value+NEW.qty*NEW.price)/(filled_qty+NEW.qty) AS INTEGER),fee=fee+NEW.fee,filled_at=NEW.ts,reserve_cash=CASE WHEN side='buy' THEN reserve_cash-NEW.qty*(limit_price+CAST((limit_price+999)/1000 AS INTEGER)) ELSE 0 END,status=CASE WHEN filled_qty+NEW.qty=qty THEN 'filled' ELSE 'partial' END WHERE id=NEW.order_id;
 UPDATE market SET revision=revision+1 WHERE id=1;
END;

--> statement-breakpoint
ALTER TABLE `stocks` ADD `nav_base` real DEFAULT 10000 NOT NULL;