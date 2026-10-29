import { pgEnum } from "drizzle-orm/pg-core";

export const endpointStatus = pgEnum("endpoint_status", ["active", "paused", "disabled_by_admin"]);

export const responseMode = pgEnum("response_mode", ["static", "cli_sync"]);

export const signatureProvider = pgEnum("signature_provider", [
  "stripe",
  "github",
  "shopify",
  "slack",
  "standard_webhooks",
  "discord",
  "hmac_sha256",
]);

export const signatureStatus = pgEnum("signature_status", ["verified", "invalid", "unchecked"]);

export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
]);

export const deliveryTrigger = pgEnum("delivery_trigger", ["auto", "replay", "manual"]);

export const deviceCodeStatus = pgEnum("device_code_status", [
  "pending",
  "approved",
  "denied",
  "consumed",
]);

export const plan = pgEnum("plan", ["free", "pro", "team"]);

/** Organization roles, lowest to highest privilege. Stored as text by Better Auth. */
export const orgRoles = ["viewer", "member", "admin", "owner"] as const;
export type OrgRole = (typeof orgRoles)[number];

/** API key scopes. Enforced by a CHECK constraint on api_key.scopes. */
export const apiKeyScopes = [
  "endpoints:read",
  "endpoints:write",
  "requests:read",
  "requests:replay",
  "tunnel",
  "destinations:write",
] as const;
export type ApiKeyScope = (typeof apiKeyScopes)[number];
