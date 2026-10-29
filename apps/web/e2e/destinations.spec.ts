import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { hydrated, signUpWithOrg } from "./helpers";

type Received = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

/** A local HTTP receiver standing in for the user's API. */
async function receiver() {
  const received: Received[] = [];
  let status = 200;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(status, { "Content-Type": "text/plain" }).end(`status ${status}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hooks`,
    received,
    respondWith: (s: number) => {
      status = s;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function freshEndpoint(page: Page, request: Parameters<typeof signUpWithOrg>[1]) {
  const { orgSlug } = await signUpWithOrg(page, request);
  await hydrated(page, "Create endpoint");
  await page.getByLabel("Name").fill("Destinations e2e");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await page.getByRole("link", { name: "Open the inbox" }).click();
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  return { orgSlug, url, inbox: page.url() };
}

/** Verifies a Standard Webhooks signature. */
function verify(secret: string, headers: IncomingMessage["headers"], body: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = `${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`;
  const expected = `v1,${createHmac("sha256", key).update(signed).digest("base64")}`;
  return String(headers["webhook-signature"]).split(" ").includes(expected);
}

test("forward captured requests to a signed destination", async ({ page, request }) => {
  const api = await receiver();
  try {
    const { url } = await freshEndpoint(page, request);
    await page.getByRole("link", { name: "Destinations" }).click();
    await hydrated(page, "Add destination");
    await page.getByRole("button", { name: "Add destination" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Local API");
    await dialog.getByLabel("URL").fill(api.url);
    await dialog.getByRole("button", { name: "Add header", exact: true }).click();
    await dialog.getByLabel("Extra headers name 1").fill("Authorization");
    await dialog.getByLabel("Extra headers value 1").fill("Bearer downstream");
    await dialog.getByLabel("POST").click();
    await dialog.getByLabel("Sign with Standard Webhooks").click();
    await dialog.getByRole("button", { name: "Add destination" }).click();

    const secret = (await page.getByTestId("signing-secret").textContent())?.trim() ?? "";
    expect(secret).toMatch(/^whsec_/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("destination")).toContainText("Local API");
    await expect(page.getByTestId("destination")).toContainText("POST");

    // Filtered out: only POSTs are forwarded.
    await request.get(`${url}/ignored`);
    const body = JSON.stringify({ type: "invoice.paid", amount: 4200 });
    await request.post(`${url}/billing?source=e2e`, {
      data: body,
      headers: { "Content-Type": "application/json", "X-Custom": "kept" },
    });

    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(1);
    const got = api.received[0];
    if (!got) throw new Error("nothing received");
    expect(got.method).toBe("POST");
    expect(got.url).toBe("/hooks/billing?source=e2e");
    expect(got.body).toBe(body);
    expect(got.headers["x-custom"]).toBe("kept");
    expect(got.headers.authorization).toBe("Bearer downstream");
    expect(got.headers["x-hookline-attempt"]).toBe("1");
    expect(verify(secret, got.headers, got.body)).toBe(true);

    // Delivery health shows up on the destination and in the request's timeline.
    await page.reload();
    await expect(page.getByTestId("destination-stats")).toContainText("100% delivered");
    await page.goBack();
    await page.getByText("/billing").first().click();
    const detail = page.getByRole("article", { name: "Request detail" });
    await detail.getByRole("tab", { name: /Deliveries/ }).click();
    await expect(detail.getByText("Delivered")).toBeVisible();
    await expect(detail.getByText("Attempt 1")).toBeVisible();
  } finally {
    await api.close();
  }
});

test("client errors fail without retries and can be retried in bulk", async ({ page, request }) => {
  test.setTimeout(90_000);
  const api = await receiver();
  api.respondWith(400);
  try {
    const { orgSlug, url } = await freshEndpoint(page, request);
    await page.getByRole("link", { name: "Destinations" }).click();
    await page.waitForURL(/\/destinations$/);
    const destinationsPage = page.url();
    await hydrated(page, "Add destination");
    await page.getByRole("button", { name: "Add destination" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Strict API");
    await dialog.getByLabel("URL").fill(api.url);
    await dialog.getByRole("button", { name: "Add destination" }).click();
    await expect(page.getByTestId("destination")).toContainText("Strict API");

    await request.post(url, { data: { n: 1 } });
    await request.post(url, { data: { n: 2 } });
    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(2);

    await page.goto(`/${orgSlug}/deliveries`);
    const rows = page.getByTestId("delivery-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Failed" })).toHaveCount(2);
    await expect(rows.first()).toContainText("400");

    api.respondWith(200);
    await page.getByRole("button", { name: "Retry failed (2)" }).click();
    await page.getByRole("button", { name: "Retry deliveries" }).click();
    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(4);
    await expect(rows.filter({ hasText: "Delivered" })).toHaveCount(2, { timeout: 20_000 });
    await expect(rows.filter({ hasText: "retried" })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^Retry failed/ })).toBeDisabled();

    // "Send test" re-delivers the newest request.
    await page.goto(destinationsPage);
    await hydrated(page, "Send test");
    await page.getByRole("button", { name: "Send test" }).click();
    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(5);
    expect(api.received[4]?.body).toBe(JSON.stringify({ n: 2 }));
  } finally {
    await api.close();
  }
});
