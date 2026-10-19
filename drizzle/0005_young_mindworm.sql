CREATE INDEX `cash_labor_day` ON `cash_events` (`user_id`,`kind`,`created`);
--> statement-breakpoint
DROP TRIGGER labor_step_validate;
--> statement-breakpoint
CREATE TRIGGER labor_step_validate BEFORE UPDATE ON labor_state BEGIN
 SELECT CASE WHEN NEW.taps!=OLD.taps+1 OR NEW.updated<OLD.updated+60 OR NEW.last_key='' OR NEW.last_key=OLD.last_key THEN RAISE(ABORT,'INVALID_LABOR_STEP') END;
 SELECT CASE WHEN COALESCE((SELECT SUM(amount) FROM cash_events WHERE user_id=NEW.user_id AND kind='노동 수당' AND settled=1 AND created>=CAST((NEW.updated+32400000)/86400000 AS INTEGER)*86400000-32400000 AND created<CAST((NEW.updated+32400000)/86400000 AS INTEGER)*86400000+54000000),0)+1000>50000 THEN RAISE(ABORT,'LABOR_DAILY_LIMIT') END;
END;
