import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  /** Public base URL of the edge (intake). Same as APP_URL behind Caddy; :8080 in development. */
  EDGE_PUBLIC_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1),
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
