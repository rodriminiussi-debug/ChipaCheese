CREATE TABLE "production_consumption_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"confirmed_by_id" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_consumption_confirmations_clientId_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "packings" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "production_weighings" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "last_save_client_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "last_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "start_client_id" uuid;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "finish_client_id" uuid;--> statement-breakpoint
ALTER TABLE "production_consumption_confirmations" ADD CONSTRAINT "production_consumption_confirmations_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_consumption_confirmations" ADD CONSTRAINT "production_consumption_confirmations_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_consumption_confirmations_run_idx" ON "production_consumption_confirmations" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "packings" ADD CONSTRAINT "packings_clientId_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "production_weighings" ADD CONSTRAINT "production_weighings_clientId_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_clientId_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_startClientId_unique" UNIQUE("start_client_id");--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_finishClientId_unique" UNIQUE("finish_client_id");