import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Organization roles and what they may do. Shared by the Better Auth server
 * and client plugins (which guard Better Auth's own organization endpoints)
 * and by the tRPC middleware (which guards everything else via ROLE_RANK).
 *
 *   viewer  read endpoints and requests
 *   member  + create/edit endpoints and destinations, replay, reveal secrets
 *   admin   + members, invitations, API keys, organization settings, audit log
 *   owner   + billing and deleting the organization
 */
export const statements = {
  ...defaultStatements,
  endpoint: ["create", "read", "update", "delete"],
  request: ["read", "replay", "delete", "reveal"],
  destination: ["create", "update", "delete"],
  apiKey: ["create", "revoke"],
  audit: ["read"],
  billing: ["manage"],
} as const;

export const ac = createAccessControl(statements);

const viewer = ac.newRole({
  endpoint: ["read"],
  request: ["read"],
});

const member = ac.newRole({
  endpoint: ["create", "read", "update", "delete"],
  request: ["read", "replay", "delete", "reveal"],
  destination: ["create", "update", "delete"],
});

const admin = ac.newRole({
  ...member.statements,
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  apiKey: ["create", "revoke"],
  audit: ["read"],
});

const owner = ac.newRole({
  ...admin.statements,
  organization: ["update", "delete"],
  billing: ["manage"],
});

export const roles = { viewer, member, admin, owner };

export type Role = keyof typeof roles;

export const ROLES: readonly Role[] = ["viewer", "member", "admin", "owner"];

/** Higher outranks lower; a procedure requiring "member" admits members, admins and owners. */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function isRole(value: string): value is Role {
  return value in ROLE_RANK;
}

export function hasRole(actual: string, required: Role): boolean {
  return isRole(actual) && ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Organization slugs that would shadow top-level routes. */
export const RESERVED_ORG_SLUGS = new Set([
  "account",
  "admin",
  "api",
  "app",
  "changelog",
  "cli",
  "dashboard",
  "docs",
  "e",
  "forgot-password",
  "h",
  "help",
  "icon",
  "invite",
  "new",
  "onboarding",
  "opengraph-image",
  "pricing",
  "privacy",
  "readme",
  "reset-password",
  "security",
  "settings",
  "sign-in",
  "sign-out",
  "sign-up",
  "static",
  "status",
  "support",
  "terms",
  "twitter-image",
  "two-factor",
  "v1",
  "verify-email",
  "www",
]);

/** 3–40 lowercase letters, digits and single dashes, not reserved. */
export function validOrgSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/.test(slug) && !RESERVED_ORG_SLUGS.has(slug);
}
