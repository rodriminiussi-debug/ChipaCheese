CREATE TYPE "public"."product_kind" AS ENUM('manufactured', 'resale', 'prepared');--> statement-breakpoint
CREATE TYPE "public"."replenishment_status" AS ENUM('requested', 'sent', 'received', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'qr' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."product_shape" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE "product_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid,
	"date" date NOT NULL,
	"unit_cost_net" numeric(14, 2) NOT NULL,
	"invoice_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_replenishment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replenishment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_requested" integer NOT NULL,
	"qty_sent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_replenishments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"status" "replenishment_status" DEFAULT 'requested' NOT NULL,
	"requested_by_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"needed_by" date,
	"sent_by_id" uuid,
	"sent_at" timestamp with time zone,
	"received_by_id" uuid,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_replenishments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "route_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"cash_expected" numeric(14, 2) NOT NULL,
	"cash_delivered" numeric(14, 2) NOT NULL,
	"checks_expected" integer DEFAULT 0 NOT NULL,
	"checks_delivered" integer DEFAULT 0 NOT NULL,
	"transfers_expected" numeric(14, 2) DEFAULT 0 NOT NULL,
	"received_by_id" uuid,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_settlements_routeId_unique" UNIQUE("route_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" "product_kind" DEFAULT 'manufactured' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "base_product_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "base_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_label" text DEFAULT 'unidad' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "default_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "available_in_store" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "available_for_orders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "voided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "store_sales" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD COLUMN "reported_by_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_invoice_item_id_purchase_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."purchase_invoice_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_replenishment_items" ADD CONSTRAINT "store_replenishment_items_replenishment_id_store_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."store_replenishments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_replenishment_items" ADD CONSTRAINT "store_replenishment_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_replenishments" ADD CONSTRAINT "store_replenishments_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_replenishments" ADD CONSTRAINT "store_replenishments_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_replenishments" ADD CONSTRAINT "store_replenishments_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_settlements" ADD CONSTRAINT "route_settlements_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_settlements" ADD CONSTRAINT "route_settlements_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_costs_lookup_idx" ON "product_costs" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "store_replenishments_status_idx" ON "store_replenishments" USING btree ("status");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_base_product_id_products_id_fk" FOREIGN KEY ("base_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_default_supplier_id_suppliers_id_fk" FOREIGN KEY ("default_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_sales" ADD CONSTRAINT "store_sales_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_uq" ON "products" USING btree ("barcode");--> statement-breakpoint
CREATE VIEW "public"."v_product_last_cost" AS (
  SELECT DISTINCT ON (product_id) product_id, supplier_id, date, unit_cost_net
  FROM product_costs
  ORDER BY product_id, date DESC, created_at DESC
);