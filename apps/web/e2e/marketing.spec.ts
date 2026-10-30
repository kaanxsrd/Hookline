import { expect, test } from "@playwright/test";

test("marketing pages, legal pages and the changelog render", async ({ page }) => {
  const pages: [string, string][] = [
    ["/", "Catch every webhook."],
    ["/pricing", "Pricing"],
    ["/changelog", "Changelog"],
    ["/security", "Security"],
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
  ];
  for (const [path, heading] of pages) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
  }

  await page.goto("/pricing");
  await expect(page.getByTestId("price-free")).toContainText("$0");
  await expect(page.getByRole("columnheader", { name: "Team" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Requests per month" })).toBeVisible();
});

test("every docs page in the sidebar renders, and the pager walks through them", async ({
  page,
}) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Introduction" })).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "Documentation" });
  const hrefs = await sidebar
    .getByRole("link")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(8);

  for (const href of hrefs.filter((h) => h !== "/docs/api")) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  await page.goto("/docs");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/docs\/endpoints$/);
});

test("status page reports each component", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("overall-status")).toBeVisible();
  for (const id of ["web", "intake", "worker", "database", "redis"]) {
    await expect(page.getByTestId(`status-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("status-database")).toContainText("Operational");
  await expect(page.getByTestId("status-web")).toContainText("Operational");
});

test("robots.txt, the sitemap and the social image are served", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/docs/cli");
  expect(sitemap).toContain("/pricing");
  expect(sitemap).not.toContain("/admin");

  const ready = await request.get("/api/readyz");
  expect(await ready.json()).toEqual({ status: "ready" });

  const image = await request.get("/opengraph-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});
