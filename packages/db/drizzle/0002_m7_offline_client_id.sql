ALTER TABLE "cleaning_records" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "temperature_logs" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "cleaning_records" ADD CONSTRAINT "cleaning_records_clientId_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_clientId_unique" UNIQUE("client_id");