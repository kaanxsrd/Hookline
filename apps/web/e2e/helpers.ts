import { createHmac, randomBytes } from "node:crypto";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import postgres from "postgres";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

export const PASSWORD = "e2e-password-long-enough";

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomBytes(5).toString("hex")}@example.com`;
}

type MailSummary = { ID: string; Subject: string; To: { Address: string }[] };

/** Waits for an email to `to` whose subject contains `subject` and returns its text body. */
export async function waitForEmail(
  request: APIRequestContext,
  to: string,
  subject: string,
): Promise<string> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const { messages } = (await res.json()) as { messages: MailSummary[] };
        found = messages.find((m) => m.Subject.includes(subject));
        return Boolean(found);
      },
      { timeout: 20_000, message: `email "${subject}" to ${to}` },
    )
    .toBe(true);
  const res = await request.get(`${MAILPIT}/api/v1/message/${found?.ID}`);
  return ((await res.json()) as { Text: string }).Text;
}

/** The first http(s) link in an email body that contains `contains`. */
export function linkIn(text: string, contains: string): string {
  const link = text.match(/https?:\/\/\S+/g)?.find((l) => l.includes(contains));
  if (!link) throw new Error(`no link containing ${contains} in:\n${text}`);
  return link;
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for a base32 secret, as authenticator apps compute it. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/**
 * Waits until the page is interactive: submit buttons stay disabled until
 * React hydrates, and typing before that would be thrown away.
 */
export async function hydrated(page: Page, button: string): Promise<void> {
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
}

/** Changes an organization's plan directly in the database (billing is off in tests). */
export async function setOrgPlan(orgSlug: string, plan: "free" | "pro" | "team"): Promise<void> {
  const sql = postgres(
    process.env.DATABASE_URL ?? "postgres://hookline:hookline@localhost:5433/hookline",
    { max: 1 },
  );
  try {
    await sql`
      UPDATE subscription SET plan = ${plan}
      WHERE org_id = (SELECT id FROM organization WHERE slug = ${orgSlug})`;
  } finally {
    await sql.end();
  }
}

/** Signs up through the UI and follows the verification email; ends signed in on `next`. */
export async function signUp(
  page: Page,
  request: APIRequestContext,
  opts: { email?: string; name?: string; next?: string } = {},
): Promise<string> {
  const email = opts.email ?? uniqueEmail();
  await page.goto(`/sign-up${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`);
  await hydrated(page, "Create account");
  await page.getByLabel("Name").fill(opts.name ?? "E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  const mail = await waitForEmail(request, email, "Verify your email");
  await page.goto(linkIn(mail, "verify-email"));
  return email;
}

/** Signs up, verifies and creates an organization; ends on the onboarding endpoint step. */
export async function signUpWithOrg(page: Page, request: APIRequestContext, orgName?: string) {
  const email = await signUp(page, request);
  await expect(page).toHaveURL(/\/onboarding$/);
  await hydrated(page, "Continue");
  const name = orgName ?? `Team ${randomBytes(3).toString("hex")}`;
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your first endpoint" })).toBeVisible();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { email, orgSlug: slug, orgName: name };
}

/** An organization's ID, read from the database. */
export async function orgIdOf(orgSlug: string): Promise<string> {
  const sql = postgres(
    process.env.DATABASE_URL ?? "postgres://hookline:hookline@localhost:5433/hookline",
    { max: 1 },
  );
  try {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM organization WHERE slug = ${orgSlug}`;
    if (!row) throw new Error(`no organization ${orgSlug}`);
    return row.id;
  } finally {
    await sql.end();
  }
}
