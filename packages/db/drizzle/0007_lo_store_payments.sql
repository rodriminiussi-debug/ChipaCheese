CREATE TABLE "store_sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_closings" ADD COLUMN "expected_card" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD COLUMN "expected_qr" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_sale_payments" ADD CONSTRAINT "store_sale_payments_sale_id_store_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."store_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_sale_payments_sale_idx" ON "store_sale_payments" USING btree ("sale_id");--> statement-breakpoint
-- Ventas existentes: un único pago por el total, con el medio que tenían.
INSERT INTO "store_sale_payments" ("sale_id", "method", "amount")
SELECT "id", "method", "total" FROM "store_sales";--> statement-breakpoint
-- Parámetros del stock del local por demanda.
INSERT INTO "app_settings" ("key", "value", "description") VALUES
  ('store.target_days', '3', 'Días de venta que debe cubrir una reposición del local'),
  ('store.replenish_lead_days', '1', 'Días que tarda la planta en reponer el local')
ON CONFLICT ("key") DO NOTHING;
