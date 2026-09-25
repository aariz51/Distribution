ALTER TABLE "accounts" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Until now the only way in was the operator's APP_PASSWORD, so every existing
-- workspace is the operator's own.
UPDATE "accounts" SET "is_owner" = true;
