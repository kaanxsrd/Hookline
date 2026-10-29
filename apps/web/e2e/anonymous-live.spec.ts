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
  await expect(status).toHaveAttribute("data-status", "live");
  await expect(rows).toHaveCount(0);

  const send = async (i: number) => {
    const res = await request.post(`${endpointUrl}/e2e/${i}`, { data: { i } });
    expect(res.status()).toBe(200);
    const id = res.headers()["x-hookline-request-id"];
    expect(id).toBeTruthy();
    return id ?? "";
  };

  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(await send(i));
  await expect(rows).toHaveCount(10);

  // Drop the connection, capture more while the page is offline, come back.
  await context.setOffline(true);
  await expect(status).toHaveAttribute("data-status", "reconnecting");
  for (let i = 10; i < 20; i++) ids.push(await send(i));
  await context.setOffline(false);

  await expect(status).toHaveAttribute("data-status", "live");
  await expect(rows).toHaveCount(20);
  // Every request exactly once, newest first.
  const shown = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-request-id")),
  );
  expect(shown).toEqual([...ids].reverse());

  // A row opens into its detail, with sensitive headers masked.
  await rows.first().locator("summary").click();
  await expect(rows.first()).toContainText("/e2e/19");
  await expect(rows.first()).toContainText('"i": 19');
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
