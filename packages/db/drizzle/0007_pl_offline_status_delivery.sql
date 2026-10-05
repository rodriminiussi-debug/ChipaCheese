CREATE TABLE "production_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" "production_status" NOT NULL,
	"client_id" uuid NOT NULL,
	"changed_by_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_status_changes_clientId_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "delivery_client_id" uuid;--> statement-breakpoint
ALTER TABLE "production_status_changes" ADD CONSTRAINT "production_status_changes_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_status_changes" ADD CONSTRAINT "production_status_changes_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_status_changes_run_idx" ON "production_status_changes" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_deliveryClientId_unique" UNIQUE("delivery_client_id");