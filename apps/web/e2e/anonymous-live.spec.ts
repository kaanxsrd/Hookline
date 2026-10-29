import { expect, test } from "@playwright/test";

test("a temporary endpoint shows requests live, including across a reconnect", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/new");
  await page.waitForURL(/\/e\/[0-9A-Za-z]{12}$/);
  const endpointUrl = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  expect(endpointUrl).toMatch(/\/h\/[0-9A-Za-z]{12}$/);

  const status = page.getByTestId("live-status");
  const rows = page.getByTestId("request-row");
  const count = page.getByTestId("request-count");
  await expect(status).toHaveAttribute("data-status", "live");
  await expect(count).toHaveText("0 requests");

  const send = async (i: number) => {
    const res = await request.post(`${endpointUrl}/e2e/${i}`, { data: { i } });
    expect(res.status()).toBe(200);
    const id = res.headers()["x-hookline-request-id"];
    expect(id).toBeTruthy();
    return id ?? "";
  };

  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(await send(i));
  await expect(count).toHaveText("10 requests");

  // Drop the connection, capture more while the page is offline, come back.
  await context.setOffline(true);
  await expect(status).toHaveAttribute("data-status", "reconnecting");
  for (let i = 10; i < 20; i++) ids.push(await send(i));
  await context.setOffline(false);

  await expect(status).toHaveAttribute("data-status", "live");
  await expect(count).toHaveText("20 requests");
  // Every request exactly once, newest first (the list is virtualized: check what is rendered).
  const shown = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-request-id")),
  );
  expect(shown.length).toBeGreaterThan(0);
  expect(shown).toEqual([...ids].reverse().slice(0, shown.length));

  // Selecting a row opens its detail.
  await rows.first().click();
  const detail = page.getByRole("article", { name: "Request detail" });
  await expect(detail).toContainText("/e2e/19");
  await expect(detail.getByRole("button", { name: '"i"' })).toBeVisible();
});

test("revisiting /new returns to the same endpoint", async ({ page }) => {
  await page.goto("/new");
  await page.waitForURL(/\/e\/[0-9A-Za-z]{12}$/);
  const first = page.url();
  await page.goto("/new");
  await page.waitForURL(/\/e\/[0-9A-Za-z]{12}$/);
  expect(page.url()).toBe(first);
});

test("an inbox without its token is not found", async ({ page }) => {
  const res = await page.goto("/e/AAAAAAAAAAAA");
  expect(res?.status()).toBe(404);
});
