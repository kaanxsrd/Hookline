import { expect, type Page, test } from "@playwright/test";
import { hydrated, signUpWithOrg } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** Signs up, creates an endpoint and returns its inbox page and intake URL. */
async function freshEndpoint(page: Page, request: Parameters<typeof signUpWithOrg>[1]) {
  const { orgSlug } = await signUpWithOrg(page, request);
  await hydrated(page, "Create endpoint");
  await page.getByLabel("Name").fill("Inbox e2e");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await page.getByRole("link", { name: "Open the inbox" }).click();
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  await expect(page.getByTestId("live-status")).toHaveAttribute("data-status", "live");
  return { orgSlug, url };
}

test("filter, search, inspect, reveal, copy, download and delete requests", async ({
  page,
  request,
}) => {
  const { orgSlug, url } = await freshEndpoint(page, request);
  const count = page.getByTestId("request-count");

  await request.post(`${url}/orders`, {
    data: { event: "order.paid", needle: "zebra-42" },
    headers: { Authorization: "Bearer secret-token-123" },
  });
  await request.get(`${url}/status?check=1&check=2`);
  await request.post(`${url}/form`, {
    form: { name: "Ada", plan: "pro" },
  });
  await expect(count).toHaveText("3 requests");

  // Method filter.
  await page.getByRole("button", { name: "Method" }).click();
  await page.getByRole("menuitemcheckbox", { name: "GET" }).click();
  await page.keyboard.press("Escape");
  await expect(count).toHaveText("1 request");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(count).toHaveText("3 requests");

  // Full-text search through bodies.
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search requests")).toBeFocused();
  await page.keyboard.type("zebra-42");
  await expect(count).toHaveText("1 request");
  await page.getByRole("button", { name: "Clear" }).click();

  // Keyboard selection: j selects the newest, then the next one.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("j");
  const detail = page.getByRole("article", { name: "Request detail" });
  await expect(detail).toContainText("/form");
  await detail.getByRole("tab", { name: "Body" }).click();
  await expect(detail.getByText("Ada")).toBeVisible();
  await page.keyboard.press("j");
  await expect(detail).toContainText("/status");
  await detail.getByRole("tab", { name: /^Query/ }).click();
  await expect(detail.getByRole("cell", { name: "2" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(detail).toContainText("/orders");

  // Sensitive headers are masked until revealed (and the reveal is audited).
  await detail.getByRole("tab", { name: /^Headers/ }).click();
  await expect(detail.getByText("secret-token-123")).toHaveCount(0);
  await detail.getByRole("button", { name: "Reveal" }).click();
  await expect(detail.getByText("Bearer secret-token-123")).toBeVisible();

  // Copy as cURL.
  await page.keyboard.press("c");
  const curl = await page.evaluate(() => navigator.clipboard.readText());
  expect(curl).toContain("curl -X POST");
  expect(curl).toContain("zebra-42");

  // Download is an attachment.
  const download = page.waitForEvent("download");
  await detail.getByRole("link", { name: "Download" }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^request-.*\.json$/);

  // Deep link.
  await detail.getByRole("button", { name: "Copy link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(link);
  await expect(page.getByRole("article", { name: "Request detail" })).toContainText("/orders");

  // Delete.
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("article", { name: "Request detail" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(count).toHaveText("2 requests");

  await page.goto(`/${orgSlug}/settings/audit-log`);
  await expect(page.getByText("request.headers_revealed")).toBeVisible();
  await expect(page.getByText("request.delete")).toBeVisible();
});

test("pausing holds live requests behind a pill", async ({ page, request }) => {
  const { url } = await freshEndpoint(page, request);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  await request.post(url, { data: { held: true } });
  const pill = page.getByRole("button", { name: "1 new" });
  await expect(pill).toBeVisible();
  await expect(page.getByTestId("request-count")).toHaveText("0 requests");

  await pill.click();
  await expect(page.getByTestId("request-count")).toHaveText("1 request");
});

test("endpoints can be paused in bulk", async ({ page, request }) => {
  const { orgSlug, url } = await freshEndpoint(page, request);
  await page.goto(`/${orgSlug}/endpoints`);
  await page.getByRole("checkbox", { name: "Select Inbox e2e" }).click();
  await page
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Pause" })
    .click();
  await expect(page.getByRole("cell", { name: "Paused" })).toBeVisible();
  expect((await request.post(url, { data: {} })).status()).toBe(410);
});

test("bodies over 64 KB are previewed from object storage and downloaded whole", async ({
  page,
  request,
}) => {
  const { url } = await freshEndpoint(page, request);
  const big = JSON.stringify({
    items: Array.from({ length: 4000 }, (_, i) => ({ i, pad: "x".repeat(20) })),
  });
  expect(big.length).toBeGreaterThan(64 * 1024);
  expect(
    (
      await request.post(`${url}/big`, {
        data: big,
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(200);

  await page.getByTestId("request-row").first().click();
  const detail = page.getByRole("article", { name: "Request detail" });
  await expect(
    detail.getByText(/Showing the first 64 KB of .* \(stored in object storage\)/),
  ).toBeVisible();

  const download = page.waitForEvent("download");
  await detail.getByRole("link", { name: "Download" }).first().click();
  const file = await (await download).path();
  const { readFile } = await import("node:fs/promises");
  expect((await readFile(file, "utf8")).length).toBe(big.length);
});
