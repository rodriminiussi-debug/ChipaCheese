CREATE TABLE "export_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"result" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD COLUMN "qty_delivered" integer;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD COLUMN "lot_change_reason" text;--> statement-breakpoint
ALTER TABLE "export_log" ADD CONSTRAINT "export_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_log" ADD CONSTRAINT "trace_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_log_created_idx" ON "export_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trace_log_created_idx" ON "trace_log" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value", "description") VALUES
	('orders.max_weekly_capacity_pct', '50'::jsonb, 'Aviso si un pedido ocupa más de este % de la capacidad semanal de producción (RF-05)')
ON CONFLICT ("key") DO NOTHING;
