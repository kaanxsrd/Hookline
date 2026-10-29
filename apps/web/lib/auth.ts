import "server-only";
import { passkey } from "@better-auth/passkey";
import { schema, uuidv7 } from "@hookline/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import { and, count, eq, gt, ne } from "drizzle-orm";
import { ChangeEmail, Invitation, ResetPassword, VerifyEmail } from "@/emails/auth-emails";
import { writeAudit } from "./audit";
import { getDb } from "./db";
import { env } from "./env";
import { sendEmailInBackground } from "./mail";
import { ac, roles, validOrgSlug } from "./permissions";
import { orgPlan } from "./plans";

function createAuth() {
  const appUrl = new URL(env().APP_URL);
  const db = getDb();

  return betterAuth({
    appName: "Hookline",
    baseURL: env().APP_URL,
    secret: env().BETTER_AUTH_SECRET,
    trustedOrigins: [appUrl.origin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        passkey: schema.passkey,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      // Not awaited: response times must not reveal whether an account exists.
      sendResetPassword: async ({ user, url }) => {
        sendEmailInBackground({
          to: user.email,
          subject: "Reset your Hookline password",
          body: ResetPassword({ name: user.name, url }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        sendEmailInBackground({
          to: user.email,
          subject: "Verify your email for Hookline",
          body: VerifyEmail({ name: user.name, url }),
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
    },
    user: {
      changeEmail: {
        enabled: true,
        // The current address approves first; the new one then confirms.
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          sendEmailInBackground({
            to: user.email,
            subject: "Approve the change of your Hookline email address",
            body: ChangeEmail({ name: user.name, newEmail, url }),
          });
        },
      },
      deleteUser: {
        enabled: true,
        // Organizations must never be left without an owner.
        beforeDelete: async (user) => {
          const owned = await db
            .select({ orgId: schema.member.organizationId, name: schema.organization.name })
            .from(schema.member)
            .innerJoin(
              schema.organization,
              eq(schema.organization.id, schema.member.organizationId),
            )
            .where(and(eq(schema.member.userId, user.id), eq(schema.member.role, "owner")));
          for (const org of owned) {
            const others = await db
              .select({ role: schema.member.role })
              .from(schema.member)
              .where(
                and(eq(schema.member.organizationId, org.orgId), ne(schema.member.userId, user.id)),
              );
            if (others.some((m) => m.role === "owner")) continue;
            if (others.length > 0) {
              throw new APIError("BAD_REQUEST", {
                message: `Make someone else an owner of ${org.name} before deleting your account.`,
              });
            }
            // The user is the only member: the organization goes with them.
            await db.delete(schema.organization).where(eq(schema.organization.id, org.orgId));
          }
        },
      },
      additionalFields: {
        isAdmin: { type: "boolean", defaultValue: false, input: false },
        disabledAt: { type: "date", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: env().AUTH_RATE_LIMIT_ENABLED,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 300, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "hookline",
      useSecureCookies: appUrl.protocol === "https:",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
      database: { generateId: () => uuidv7() },
      // Caddy sets X-Forwarded-For to the client address (see lib/client-ip.ts).
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ disabledAt: schema.user.disabledAt })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            if (user?.disabledAt) {
              throw new APIError("FORBIDDEN", { message: "This account has been disabled." });
            }
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: "Hookline" }),
      passkey({ rpID: appUrl.hostname, rpName: "Hookline", origin: appUrl.origin }),
      organization({
        ac,
        roles,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 48,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async ({ email, organization: org, inviter, invitation }) => {
          sendEmailInBackground({
            to: email,
            subject: `${inviter.user.name} invited you to ${org.name} on Hookline`,
            body: Invitation({
              inviter: inviter.user.name,
              organization: org.name,
              role: invitation.role,
              url: `${env().APP_URL}/invite/${invitation.id}`,
            }),
          });
        },
        organizationHooks: {
          beforeCreateOrganization: async ({ organization: org }) => {
            if (!validOrgSlug(org.slug ?? "")) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "Use 3–40 lowercase letters, numbers and dashes for the URL, and avoid reserved words.",
              });
            }
          },
          afterCreateOrganization: async ({ organization: org, user }) => {
            await db
              .insert(schema.subscription)
              .values({ orgId: org.id, plan: "free" })
              .onConflictDoNothing({ target: schema.subscription.orgId });
            await writeAudit(db, {
              orgId: org.id,
              actorUserId: user.id,
              action: "organization.created",
              targetType: "organization",
              targetId: org.id,
              metadata: { name: org.name, slug: org.slug },
            });
          },
          beforeCreateInvitation: async ({ organization: org }) => {
            const { limits } = await orgPlan(db, org.id);
            if (limits.members === null) return;
            const [members] = await db
              .select({ n: count() })
              .from(schema.member)
              .where(eq(schema.member.organizationId, org.id));
            const [pending] = await db
              .select({ n: count() })
              .from(schema.invitation)
              .where(
                and(
                  eq(schema.invitation.organizationId, org.id),
                  eq(schema.invitation.status, "pending"),
                  gt(schema.invitation.expiresAt, new Date()),
                ),
              );
            if ((members?.n ?? 0) + (pending?.n ?? 0) >= limits.members) {
              throw new APIError("FORBIDDEN", {
                message: `Your plan includes ${limits.members} ${limits.members === 1 ? "member" : "members"}. Upgrade to invite more people.`,
              });
            }
          },
        },
      }),
      // Must be last: lets server actions set Better Auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

const globalForAuth = globalThis as typeof globalThis & { __hooklineAuth?: Auth };

/** Built lazily so importing this module (e.g. during `next build`) never touches the database. */
export function getAuth(): Auth {
  globalForAuth.__hooklineAuth ??= createAuth();
  return globalForAuth.__hooklineAuth;
}
