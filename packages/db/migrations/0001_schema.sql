CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_trigger" AS ENUM('auto', 'replay', 'manual');--> statement-breakpoint
CREATE TYPE "public"."device_code_status" AS ENUM('pending', 'approved', 'denied', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."endpoint_status" AS ENUM('active', 'paused', 'disabled_by_admin');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'team');--> statement-breakpoint
CREATE TYPE "public"."response_mode" AS ENUM('static', 'cli_sync');--> statement-breakpoint
CREATE TYPE "public"."signature_provider" AS ENUM('stripe', 'github', 'shopify', 'slack', 'standard_webhooks', 'discord', 'hmac_sha256');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('verified', 'invalid', 'unchecked');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" "bytea" NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_scopes_check" CHECK ("api_key"."scopes" <@ ARRAY['endpoints:read', 'endpoints:write', 'requests:read', 'requests:replay', 'tunnel', 'destinations:write']::text[])
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"actor_api_key_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_device_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_code_hash" "bytea" NOT NULL,
	"user_code" text NOT NULL,
	"status" "device_code_status" DEFAULT 'pending' NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"api_key_id" uuid,
	"client_name" text,
	"client_ip" "inet",
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_device_code_user_code_check" CHECK ("cli_device_code"."user_code" ~ '^[A-Z]{4}-[A-Z]{4}$')
);
--> statement-breakpoint
CREATE TABLE "delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"request_received_at" timestamp with time zone NOT NULL,
	"destination_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"org_id" uuid,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"trigger" "delivery_trigger" DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status_code" integer,
	"error" text,
	"response_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"response_body" "bytea",
	"duration_ms" real,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"sign_with_standard_webhooks" boolean DEFAULT false NOT NULL,
	"signing_secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_url_check" CHECK ("destination"."url" ~* '^https?://'),
	CONSTRAINT "destination_timeout_check" CHECK ("destination"."timeout_ms" BETWEEN 1000 AND 30000),
	CONSTRAINT "destination_max_attempts_check" CHECK ("destination"."max_attempts" BETWEEN 1 AND 20),
	CONSTRAINT "destination_signing_check" CHECK (NOT "destination"."sign_with_standard_webhooks" OR "destination"."signing_secret_enc" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "endpoint" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "endpoint_status" DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"response_mode" "response_mode" DEFAULT 'static' NOT NULL,
	"response_status" integer DEFAULT 200 NOT NULL,
	"response_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"response_body" text DEFAULT '' NOT NULL,
	"response_delay_ms" integer DEFAULT 0 NOT NULL,
	"sync_timeout_ms" integer DEFAULT 10000 NOT NULL,
	"signature_provider" "signature_provider",
	"signature_secret_enc" text,
	"retention_hours" integer DEFAULT 24 NOT NULL,
	"anonymous_view_token_hash" "bytea",
	"anonymous_creator_ip" "inet",
	"expires_at" timestamp with time zone,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"last_request_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endpoint_slug_unique" UNIQUE("slug"),
	CONSTRAINT "endpoint_slug_check" CHECK ("endpoint"."slug" ~ '^[0-9A-Za-z]{12}$'),
	CONSTRAINT "endpoint_owner_check" CHECK ("endpoint"."org_id" IS NOT NULL OR "endpoint"."expires_at" IS NOT NULL),
	CONSTRAINT "endpoint_response_status_check" CHECK ("endpoint"."response_status" BETWEEN 100 AND 599),
	CONSTRAINT "endpoint_response_delay_check" CHECK ("endpoint"."response_delay_ms" BETWEEN 0 AND 30000),
	CONSTRAINT "endpoint_sync_timeout_check" CHECK ("endpoint"."sync_timeout_ms" BETWEEN 1000 AND 30000),
	CONSTRAINT "endpoint_retention_check" CHECK ("endpoint"."retention_hours" >= 1),
	CONSTRAINT "endpoint_signature_check" CHECK ("endpoint"."signature_provider" IS NULL OR "endpoint"."signature_secret_enc" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"response_status" integer,
	"response" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_role_check" CHECK ("invitation"."role" IN ('viewer', 'member', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_role_check" CHECK ("member"."role" IN ('viewer', 'member', 'admin', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"org_id" uuid,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_type" text,
	"body_inline" "bytea",
	"body_s3_key" text,
	"body_size" integer DEFAULT 0 NOT NULL,
	"body_sha256" "bytea",
	"source_ip" "inet",
	"user_agent" text,
	"signature_status" "signature_status" DEFAULT 'unchecked' NOT NULL,
	"response_status" integer,
	"duration_ms" real,
	CONSTRAINT "request_pkey" PRIMARY KEY("id","received_at"),
	CONSTRAINT "request_body_location_check" CHECK ("request"."body_inline" IS NULL OR "request"."body_s3_key" IS NULL)
) PARTITION BY RANGE ("received_at"); -- hand edit: Drizzle cannot express partitioning (see schema/endpoints.ts)
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"plan_override" "plan",
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'none' NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"deliveries" bigint DEFAULT 0 NOT NULL,
	"tunnel_minutes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_pkey" PRIMARY KEY("org_id","day")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_api_key_id_api_key_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_code" ADD CONSTRAINT "cli_device_code_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_code" ADD CONSTRAINT "cli_device_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_code" ADD CONSTRAINT "cli_device_code_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_endpoint_id_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination" ADD CONSTRAINT "destination_endpoint_id_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint" ADD CONSTRAINT "endpoint_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_endpoint_id_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_idx" ON "api_key" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_key_org_id_idx" ON "api_key" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("org_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_code_hash_idx" ON "cli_device_code" USING btree ("device_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_code_user_code_idx" ON "cli_device_code" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "delivery_request_idx" ON "delivery" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "delivery_destination_created_idx" ON "delivery" USING btree ("destination_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "delivery_org_created_idx" ON "delivery" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "delivery_org_failed_idx" ON "delivery" USING btree ("org_id","created_at" DESC NULLS LAST) WHERE "delivery"."status" = 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempt_delivery_no_idx" ON "delivery_attempt" USING btree ("delivery_id","attempt_no");--> statement-breakpoint
CREATE INDEX "destination_endpoint_id_idx" ON "destination" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "endpoint_org_id_idx" ON "endpoint" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "endpoint_expires_at_idx" ON "endpoint" USING btree ("expires_at") WHERE "endpoint"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "endpoint_anonymous_creator_ip_idx" ON "endpoint" USING btree ("anonymous_creator_ip","created_at") WHERE "endpoint"."org_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_org_key_idx" ON "idempotency_key" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "request_endpoint_received_idx" ON "request" USING btree ("endpoint_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_org_id_idx" ON "subscription" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_customer_idx" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_subscription_idx" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");