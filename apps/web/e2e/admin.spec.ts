import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { hydrated, orgIdOf, signUp, signUpWithOrg } from "./helpers";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://hookline:hookline@localhost:5433/hookline";

async function query<T extends Record<string, unknown>>(
  run: (sql: postgres.Sql) => Promise<T[]>,
): Promise<T[]> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** What `bun run admin:grant` does. */
async function makeAdmin(email: string): Promise<void> {
  await query((sql) => sql`UPDATE "user" SET is_admin = true WHERE email = ${email} RETURNING id`);
}

/** Signs up an organization with one endpoint and returns its intake URL. */
async function orgWithEndpoint(page: Page, request: Parameters<typeof signUpWithOrg>[1]) {
  const org = await signUpWithOrg(page, request);
  await hydrated(page, "Create endpoint");
  await page.getByLabel("Name").fill("Admin e2e");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await page.getByRole("link", { name: "Open the inbox" }).click();
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  return { ...org, url, slug: url.split("/h/")[1] ?? "" };
}

test("administration is invisible to everyone but administrators", async ({ page, request }) => {
  const { orgSlug, email } = await signUpWithOrg(page, request);
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);

  await makeAdmin(email);
  await page.goto(`/${orgSlug}`);
  await page.getByRole("button", { name: /E2E User/ }).click();
  await page.getByRole("menuitem", { name: "Administration" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Organizations by plan")).toBeVisible();
});

test("an administrator disables and re-enables an endpoint", async ({ page, request }) => {
  const { email, url, slug } = await orgWithEndpoint(page, request);
  expect((await request.post(url, { data: { ok: true } })).status()).toBe(200);
  await makeAdmin(email);

  await page.goto(`/admin/endpoints?q=${slug}`);
  const row = page.getByRole("row").filter({ hasText: slug });
  await row.getByRole("button", { name: "Disable" }).click();
  await page.getByLabel("Reason").fill("Phishing page in the configured response");
  await page.getByRole("button", { name: "Disable endpoint" }).click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();

  const blocked = await request.post(url, { data: { ok: true } });
  expect(blocked.status()).toBe(410);
  expect((await blocked.json()).error.code).toBe("endpoint_disabled");

  await row.getByRole("button", { name: "Enable" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect.poll(async () => (await request.post(url, { data: {} })).status()).toBe(200);

  await page.goto("/admin/audit-log");
  // The instance log holds every test's entries; ours is the newest of each kind.
  await expect(page.getByRole("cell", { name: "admin.endpoint.disabled" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "admin.endpoint.enabled" }).first()).toBeVisible();
});

test("an administrator assigns a plan to an organization", async ({ page, request }) => {
  const { email, orgSlug } = await signUpWithOrg(page, request);
  await makeAdmin(email);
  const orgId = await orgIdOf(orgSlug);

  await page.goto(`/admin/organizations/${orgId}`);
  // Save stays disabled until another plan is picked, which also proves hydration.
  await expect(async () => {
    await page.getByLabel("Assigned plan").click();
    await page.getByRole("option", { name: "Team" }).click();
    await expect(page.getByRole("button", { name: "Save plan" })).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText(/Plan updated for/)).toBeVisible();

  await expect
    .poll(async () => {
      const [row] = await query<{ plan_override: string | null }>(
        (sql) => sql`SELECT plan_override FROM subscription WHERE org_id = ${orgId}`,
      );
      return row?.plan_override;
    })
    .toBe("team");
  const [audit] = await query<{ n: number }>(
    (sql) =>
      sql`SELECT count(*)::int AS n FROM audit_log WHERE org_id = ${orgId} AND action = 'billing.plan_changed'`,
  );
  expect(audit?.n).toBe(1);

  await page.goto(`/${orgSlug}/usage`);
  await expect(page.getByText("Team plan", { exact: true })).toBeVisible();
});

test("disabling a user signs them out and blocks sign-in", async ({ browser, page, request }) => {
  const { email: adminEmail } = await signUpWithOrg(page, request);
  await makeAdmin(adminEmail);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const otherEmail = await signUp(other, request, { name: "Soon Disabled" });
  await expect(other).toHaveURL(/\/onboarding$/);

  await page.goto(`/admin/users`);
  await page.getByLabel("Search by name or email").fill(otherEmail);
  await page.getByRole("link", { name: /Soon Disabled/ }).click();
  await page.getByRole("button", { name: "Disable account" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("button", { name: "Enable account" })).toBeVisible();

  await other.goto("/dashboard");
  await expect(other).toHaveURL(/\/sign-in/);
  await otherContext.close();

  const [row] = await query<{ disabled: boolean; sessions: number }>(
    (sql) => sql`SELECT disabled_at IS NOT NULL AS disabled,
      (SELECT count(*)::int FROM session WHERE user_id = "user".id) AS sessions
      FROM "user" WHERE email = ${otherEmail}`,
  );
  expect(row).toEqual({ disabled: true, sessions: 0 });
});
