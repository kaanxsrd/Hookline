import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  /** Public base URL of the edge (intake). Same as APP_URL behind Caddy; :8080 in development. */
  EDGE_PUBLIC_URL: z.url().optional(),
  /** Where the web app reaches the edge directly (its /readyz feeds the status page). */
  EDGE_INTERNAL_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1),
  /** Connections per server process. Keep it small on serverless hosts (Vercel), where many instances run. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().min(1).default("redis://localhost:6380/0"),
  /** Signs Better Auth sessions and tokens. */
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_URL: z.string().min(1).default("smtp://localhost:1025"),
  /** Object storage for bodies over 64 KiB (read here for previews and downloads). */
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MAIL_FROM: z.string().min(3).default("Hookline <no-reply@hookline.localhost>"),
  /**
   * Microsoft Graph (HTTPS) instead of SMTP, as the MAIL_FROM mailbox: for
   * hosts that block outbound SMTP. All three set means Graph is used.
   */
  MS_GRAPH_TENANT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_ID: z.string().optional(),
  MS_GRAPH_CLIENT_SECRET: z.string().optional(),
  /** Better Auth's sign-in/sign-up rate limits. Only development and tests turn them off. */
  AUTH_RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** "unlimited" on self-hosted instances lifts every plan limit. */
  PLAN_OVERRIDE: z.enum(["", "unlimited"]).default(""),
  /** kid:base64key[,kid:base64key...]: encrypts destination signing secrets (shared with the worker). */
  DATA_ENCRYPTION_KEY: z.string().min(1),
  /** Lets destinations target loopback and private networks. Self-hosted development only. */
  ALLOW_PRIVATE_DESTINATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Stripe billing; unset disables billing (self-hosted instances usually leave it off). */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Verifies Stripe webhooks at /api/stripe/webhook. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Signs SSE stream tokens; the edge verifies them with the same secret. */
  STREAM_TOKEN_SECRET: z.string().min(32),
  /** Addresses exempt from the anonymous-endpoint daily cap (development and tests only). */
  ANONYMOUS_LIMIT_EXEMPT_IPS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof schema> & { EDGE_PUBLIC_URL: string };

let cached: Env | undefined;

/** Validated server environment. Throws with every problem listed on first use. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${problems.join("\n")}`);
  }
  cached = {
    ...parsed.data,
    EDGE_PUBLIC_URL: (parsed.data.EDGE_PUBLIC_URL ?? parsed.data.APP_URL).replace(/\/+$/, ""),
  };
  return cached;
}

/** Whether cookies should carry the Secure attribute. */
export function secureCookies(): boolean {
  return env().APP_URL.startsWith("https://");
}

/** The public intake URL of an endpoint. */
export function intakeUrl(slug: string): string {
  return `${env().EDGE_PUBLIC_URL}/h/${slug}`;
}
