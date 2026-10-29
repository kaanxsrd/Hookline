"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // Runs outside React; a full navigation keeps the pending sign-in cookie.
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = `/two-factor${next ? `?next=${encodeURIComponent(next)}` : ""}`;
      },
    }),
    passkeyClient(),
    organizationClient({ ac, roles }),
  ],
});

type AuthError =
  | { code?: string | undefined; message?: string | undefined; status?: number }
  | null
  | undefined;

/** Calm, specific copy for Better Auth error codes. */
export function authErrorMessage(error: AuthError): string {
  if (!error) return "Something went wrong. Please try again.";
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match an account.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email first. We've sent you a new link.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Try signing in.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters.";
    case "INVALID_TOKEN":
      return "This link is invalid or has expired. Request a new one.";
    case "INVALID_TWO_FACTOR_AUTHENTICATION":
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
      return "That code isn't valid. Check your authenticator and try again.";
    default:
      return error.message ?? "Something went wrong. Please try again.";
  }
}

/** Only same-origin relative paths are followed after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : fallback;
}
