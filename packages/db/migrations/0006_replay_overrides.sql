CREATE TABLE "delivery_override" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_override_method_check" CHECK ("delivery_override"."method" ~ '^[A-Z]{1,16}$'),
	CONSTRAINT "delivery_override_path_check" CHECK ("delivery_override"."path" LIKE '/%'),
	CONSTRAINT "delivery_override_body_check" CHECK ("delivery_override"."body" IS NULL OR octet_length("delivery_override"."body") <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "endpoint" DROP CONSTRAINT "endpoint_signature_check";--> statement-breakpoint
ALTER TABLE "delivery_override" ADD CONSTRAINT "delivery_override_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;