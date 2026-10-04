CREATE TABLE "training_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"score" integer NOT NULL,
	"total" integer NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_progress_uq" ON "training_progress" USING btree ("user_id","module_key");--> statement-breakpoint
CREATE INDEX "training_progress_user_idx" ON "training_progress" USING btree ("user_id");