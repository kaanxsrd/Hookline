import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { orgIdOf, signUpWithOrg, waitForEmail } from "./helpers";

// Matches STRIPE_WEBHOOK_SECRET in .env.example.
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_dev_only_change_me";

/** Posts an event signed the way Stripe signs webhooks. */
function sendEvent(
  request: APIRequestContext,
  type: string,
  object: Record<string, unknown>,
  secret = WEBHOOK_SECRET,
) {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${v1}` },
  });
}

function subscription(orgId: string, lookupKey: string, status = "active") {
  return {
    id: `sub_${orgId.slice(0, 8)}`,
    object: "subscription",
    customer: `cus_${orgId.slice(0, 8)}`,
    status,
    cancel_at_period_end: false,
    metadata: { org_id: orgId },
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          price: { id: "price_1", lookup_key: lookupKey },
        },
      ],
    },
  };
}

test("billing is off until configured; Stripe webhooks change the plan", async ({
  page,
  request,
}) => {
  const { orgSlug, email } = await signUpWithOrg(page, request);
  const orgId = await orgIdOf(orgSlug);

  await page.goto(`/${orgSlug}/settings/billing`);
  await expect(page.getByTestId("current-plan")).toHaveText("Free");
  await expect(page.getByTestId("billing-disabled")).toBeVisible();
  await page.goto(`/${orgSlug}/settings/audit-log`);
  await expect(page.getByText("The audit log is not included in your plan.")).toBeVisible();

  // Forged events are refused.
  const forged = await sendEvent(
    request,
    "customer.subscription.created",
    subscription(orgId, "hookline_pro_monthly"),
    "whsec_wrong",
  );
  expect(forged.status()).toBe(400);

  const res = await sendEvent(
    request,
    "customer.subscription.created",
    subscription(orgId, "hookline_pro_monthly"),
  );
  expect(res.status()).toBe(200);
  await page.goto(`/${orgSlug}/settings/billing`);
  await expect(page.getByTestId("current-plan")).toHaveText("Pro");
  await expect(page.getByText(/Renews on/)).toBeVisible();
  await waitForEmail(request, email, "is now on the Pro plan");

  await page.goto(`/${orgSlug}/usage`);
  await expect(page.getByTestId("meter-requests")).toContainText("of 250,000");
  await page.goto(`/${orgSlug}/settings/audit-log`);
  await expect(page.getByText("billing.plan_changed")).toBeVisible();

  // Cancellation returns the organization to Free.
  await sendEvent(
    request,
    "customer.subscription.deleted",
    subscription(orgId, "hookline_pro_monthly", "canceled"),
  );
  await page.goto(`/${orgSlug}/settings/billing`);
  await expect(page.getByTestId("current-plan")).toHaveText("Free");
});

test("the usage page shows this month against the plan", async ({ page, request }) => {
  const { orgSlug } = await signUpWithOrg(page, request);
  await page.goto(`/${orgSlug}/usage`);
  await expect(page.getByTestId("meter-requests")).toContainText("of 5,000");
  await expect(page.getByTestId("meter-endpoints")).toContainText("of 3");
  await page.getByRole("button", { name: "Show table" }).click();
  await expect(page.getByRole("columnheader", { name: "Requests" })).toBeVisible();
});
