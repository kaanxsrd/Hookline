import { expect, test } from "@playwright/test";
import {
  hydrated,
  linkIn,
  PASSWORD,
  setOrgPlan,
  signUp,
  signUpWithOrg,
  totp,
  uniqueEmail,
  waitForEmail,
} from "./helpers";

test("sign up, verify, onboard, create an endpoint and watch it live", async ({
  page,
  request,
}) => {
  await signUpWithOrg(page, request);
  await page.getByLabel("Name").fill("Stripe staging");
  await page.getByRole("button", { name: "Create endpoint" }).click();

  await expect(page.getByRole("heading", { name: "You're ready" })).toBeVisible();
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  expect(url).toMatch(/\/h\/[0-9A-Za-z]{12}$/);

  await page.getByRole("link", { name: "Open the inbox" }).click();
  await expect(page.getByRole("heading", { name: /Stripe staging/ })).toBeVisible();
  await expect(page.getByTestId("live-status")).toHaveAttribute("data-status", "live");

  for (let i = 0; i < 3; i++) {
    expect((await request.post(`${url}/charge/${i}`, { data: { i } })).status()).toBe(200);
  }
  await expect(page.getByTestId("request-count")).toHaveText("3 requests");
});

test("a temporary endpoint can be kept by signing up", async ({ page, request }) => {
  await page.goto("/new");
  await page.waitForURL(/\/e\/[0-9A-Za-z]{12}$/);
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  const slug = url.split("/").at(-1) ?? "";
  for (let i = 0; i < 2; i++) await request.post(url, { data: { i } });
  await expect(page.getByTestId("request-count")).toHaveText("2 requests");

  await page.getByRole("link", { name: "Sign up to keep it" }).click();
  await signUp(page, request, { next: "/onboarding" });
  await page.getByLabel("Name").fill(`Keepers ${Date.now()}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Keep my temporary endpoint" }).click();

  await expect(page).toHaveURL(new RegExp(`/endpoints/${slug}$`));
  await expect(page.getByTestId("request-count")).toHaveText("2 requests");
  // The anonymous inbox is gone; the URL itself keeps capturing.
  expect((await page.request.get(`/e/${slug}`)).status()).toBe(404);
  expect((await request.post(url, { data: {} })).status()).toBe(200);
});

test("admins invite members with a role; viewers cannot create endpoints", async ({
  page,
  browser,
  request,
}) => {
  const { orgSlug } = await signUpWithOrg(page, request);
  await page.goto(`/${orgSlug}/settings/members`);
  await hydrated(page, "Send invitation");
  const invitee = uniqueEmail("viewer");
  const invite = async () => {
    await page.getByLabel("Email").fill(invitee);
    await page.getByLabel("Role").click();
    await page.getByRole("option", { name: "viewer" }).click();
    await page.getByRole("button", { name: "Send invitation" }).click();
  };

  // The Free plan has one seat, already taken by the owner.
  await invite();
  await expect(page.getByText("Your plan includes 1 member")).toBeVisible();

  await setOrgPlan(orgSlug, "pro");
  await invite();
  await expect(page.getByText(invitee)).toBeVisible();

  const mail = await waitForEmail(request, invitee, "invited you");
  const inviteUrl = new URL(linkIn(mail, "/invite/"));

  const other = await browser.newContext();
  const guest = await other.newPage();
  await signUp(guest, request, { email: invitee, next: inviteUrl.pathname });
  await expect(guest).toHaveURL(inviteUrl.pathname);
  await guest.getByRole("button", { name: "Accept invitation" }).click();
  await expect(guest).toHaveURL(new RegExp(`/${orgSlug}$`));

  await guest.goto(`/${orgSlug}/endpoints`);
  await expect(guest.getByRole("heading", { name: "Endpoints" })).toBeVisible();
  await expect(guest.getByRole("link", { name: "New endpoint" })).toHaveCount(0);
  await guest.goto(`/${orgSlug}/settings/audit-log`);
  await expect(guest.getByText("This page could not be found")).toBeVisible();
  await other.close();

  await page.goto(`/${orgSlug}/settings/audit-log`);
  await expect(page.getByText("invitation.created")).toBeVisible();
  await expect(page.getByText("organization.created")).toBeVisible();
});

test("two-factor authentication guards password sign-in", async ({ page, request }) => {
  const email = await signUp(page, request);
  await page.goto("/account");
  await page
    .locator("form")
    .filter({ hasText: "Set up two-factor" })
    .getByLabel("Password")
    .fill(PASSWORD);
  await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  await page.getByLabel("Code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("backup-codes")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/two-factor/);
  await page.getByLabel("Code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("passkeys sign in without a password", async ({ page, request }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await signUp(page, request);
  await page.goto("/account");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("the app requires signing in", async ({ page }) => {
  await page.goto("/demo/endpoints");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdemo%2Fendpoints$/);
});
