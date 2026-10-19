CREATE TABLE `labor_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`taps` integer DEFAULT 0 NOT NULL,
	`last_key` text DEFAULT '' NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TRIGGER research_purchase_validate;
--> statement-breakpoint
CREATE TRIGGER research_purchase_validate BEFORE INSERT ON research_purchases BEGIN
 SELECT CASE WHEN NEW.cost!=300000 OR NEW.expires!=NEW.created+86400000 THEN RAISE(ABORT,'INVALID_SUBSCRIPTION') END;
 SELECT CASE WHEN COALESCE((SELECT expires FROM subscriptions WHERE user_id=NEW.user_id),0)>NEW.created THEN RAISE(ABORT,'SUBSCRIPTION_ACTIVE') END;
 SELECT CASE WHEN COALESCE((SELECT cash FROM accounts WHERE id=NEW.user_id),0)<NEW.cost THEN RAISE(ABORT,'SUBSCRIPTION_FUNDS') END;
END;
--> statement-breakpoint
CREATE TRIGGER labor_step_validate BEFORE UPDATE ON labor_state BEGIN
 SELECT CASE WHEN NEW.taps!=OLD.taps+1 OR NEW.updated<OLD.updated+60 OR NEW.last_key='' OR NEW.last_key=OLD.last_key THEN RAISE(ABORT,'INVALID_LABOR_STEP') END;
END;
--> statement-breakpoint
CREATE TRIGGER labor_pay AFTER UPDATE ON labor_state WHEN NEW.taps%100=0 BEGIN
 INSERT INTO cash_events(id,user_id,stock_id,kind,amount,due_at,settled,created) VALUES('labor-'||NEW.user_id||'-'||NEW.taps,NEW.user_id,NULL,'노동 수당',1000,NEW.updated,1,NEW.updated);
 UPDATE accounts SET cash=cash+1000 WHERE id=NEW.user_id;
END;
