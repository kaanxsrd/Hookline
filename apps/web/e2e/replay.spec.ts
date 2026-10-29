import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { hydrated, signUpWithOrg } from "./helpers";

type Received = { method: string; url: string; body: string; headers: IncomingMessage["headers"] };

async function receiver() {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/in`,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function freshEndpoint(page: Page, request: APIRequestContext) {
  const { orgSlug } = await signUpWithOrg(page, request);
  await hydrated(page, "Create endpoint");
  await page.getByLabel("Name").fill("M9 e2e");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await page.getByRole("link", { name: "Open the inbox" }).click();
  await page.waitForURL(/\/endpoints\/[0-9A-Za-z]{12}$/);
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  return { orgSlug, url, inbox: page.url() };
}

test("custom responses, signature verification and URL regeneration", async ({ page, request }) => {
  const { url, inbox } = await freshEndpoint(page, request);
  await page.goto(`${inbox}/settings`);

  // Response: status, header, body and delay, with a live preview.
  await hydrated(page, "Save response");
  await page.getByLabel("Status").fill("201");
  await page.getByRole("button", { name: "Add response header" }).click();
  await page.getByLabel("Response header name 1").fill("X-Reply");
  await page.getByLabel("Response header value 1").fill("from-hookline");
  await page.getByLabel("Body").fill('{"accepted":true}');
  await page.getByLabel("Delay (ms)").fill("300");
  await expect(page.getByTestId("response-preview")).toContainText("HTTP/1.1 201 Created");
  await expect(page.getByTestId("response-preview")).toContainText("X-Reply: from-hookline");
  await page.getByRole("button", { name: "Save response" }).click();
  await expect(page.getByText("Response saved")).toBeVisible();

  const start = Date.now();
  const res = await request.post(url, {
    data: "Hello, World!",
    headers: { "Content-Type": "text/plain" },
  });
  expect(res.status()).toBe(201);
  expect(res.headers()["x-reply"]).toBe("from-hookline");
  expect(await res.text()).toBe('{"accepted":true}');
  expect(Date.now() - start).toBeGreaterThanOrEqual(280);

  // Signature verification: GitHub's documented example.
  await page.getByLabel("Signature provider").click();
  await page.getByRole("option", { name: "GitHub" }).click();
  await page.getByLabel("Webhook secret").fill("It's a Secret to Everybody");
  // The request sent above has no signature header.
  await page.getByRole("button", { name: "Test against the last request" }).click();
  await expect(page.getByTestId("signature-test-result")).toContainText("Invalid");
  await expect(page.getByTestId("signature-test-result")).toContainText("X-Hub-Signature-256");
  await page.getByRole("button", { name: "Save verification" }).click();
  await expect(page.getByText("Verification saved")).toBeVisible();

  await request.post(url, {
    data: "Hello, World!",
    headers: {
      "Content-Type": "text/plain",
      "X-Hub-Signature-256":
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    },
  });
  await page.reload();
  await hydrated(page, "Save verification");
  await page.getByRole("button", { name: "Test against the last request" }).click();
  await expect(page.getByTestId("signature-test-result")).toContainText("Verified");

  await page.goto(inbox);
  const rows = page.getByTestId("request-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Verified");
  // Compact rows show no badge for unchecked requests.
  await expect(rows.nth(1)).not.toContainText("Verified");

  // A new URL: the old one stops working.
  await page.goto(`${inbox}/settings`);
  await hydrated(page, "Regenerate URL");
  await page.getByRole("button", { name: "Regenerate URL" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Regenerate URL" }).click();
  await page.waitForURL((u) => !u.pathname.includes(inbox.split("/").pop() ?? "x"));
  expect((await request.post(url, { data: "{}" })).status()).toBe(404);
});

test("replay to a destination, edited replay and the r shortcut", async ({ page, request }) => {
  const api = await receiver();
  try {
    const { url, inbox } = await freshEndpoint(page, request);
    await page.goto(`${inbox}/destinations`);
    await hydrated(page, "Add destination");
    await page.getByRole("button", { name: "Add destination" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Local");
    await dialog.getByLabel("URL").fill(api.url);
    await dialog.getByRole("button", { name: "Add destination" }).click();
    await expect(page.getByTestId("destination")).toContainText("Local");

    await request.post(`${url}/orders`, {
      data: { amount: 10 },
      headers: { Authorization: "Bearer captured-secret" },
    });
    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(1);

    await page.goto(inbox);
    await page.getByTestId("request-row").first().click();
    const detail = page.getByRole("article", { name: "Request detail" });

    // Replay ▾ → To Local
    await detail.getByRole("button", { name: /^Replay/ }).click();
    await page.getByRole("menuitem", { name: "To Local" }).click();
    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(2);
    expect(api.received[1]?.body).toBe(api.received[0]?.body);

    // r opens the menu; Edit & replay changes the body, keeps masked headers.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("r");
    await page.getByRole("menuitem", { name: "Edit & replay…" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit & replay" });
    await expect(sheet.getByLabel("Body")).toHaveValue('{"amount":10}');
    await sheet.getByLabel("Method").fill("PUT");
    await sheet.getByLabel("Body").fill('{"amount":99}');
    await sheet.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => api.received.length, { timeout: 20_000 }).toBe(3);
    const edited = api.received[2];
    expect(edited?.method).toBe("PUT");
    expect(edited?.url).toBe("/in/orders");
    expect(edited?.body).toBe('{"amount":99}');
    expect(edited?.headers.authorization).toBe("Bearer captured-secret");

    // The timeline shows the replays.
    await detail.getByRole("tab", { name: /Deliveries/ }).click();
    await expect(detail.getByText("replay", { exact: true })).toHaveCount(2);
  } finally {
    await api.close();
  }
});
