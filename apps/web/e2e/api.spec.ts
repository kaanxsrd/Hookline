import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { hydrated, signUpWithOrg } from "./helpers";
import { covered, expectContract, operations } from "./openapi";

const ALL_SCOPES = [
  "endpoints:read",
  "endpoints:write",
  "requests:read",
  "requests:replay",
  "destinations:write",
  "tunnel",
];

/** Creates a key on Settings → API keys and returns it. */
async function createKey(
  page: Page,
  orgSlug: string,
  name: string,
  scopes: string[],
): Promise<string> {
  await page.goto(`/${orgSlug}/settings/api-keys`);
  await hydrated(page, "Create API key");
  await page.getByRole("button", { name: "Create API key" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  for (const scope of ALL_SCOPES) {
    const box = dialog.getByRole("checkbox", { name: scope, exact: true });
    if (scopes.includes(scope) !== (await box.isChecked())) await box.click();
  }
  await dialog.getByRole("button", { name: "Create key" }).click();
  const key = (await page.getByTestId("new-api-key").textContent())?.trim() ?? "";
  expect(key).toMatch(/^hk_live_[0-9A-Za-z]{43}$/);
  await page.getByRole("button", { name: "Done" }).click();
  return key;
}

test("every /api/v1 operation matches api/openapi.yaml", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { orgSlug } = await signUpWithOrg(page, request);
  const key = await createKey(page, orgSlug, "Contract tests", ALL_SCOPES);
  const tunnelOnly = await createKey(page, orgSlug, "Tunnel only", ["tunnel"]);
  await expect(page.getByTestId("api-key-row")).toHaveCount(2);

  const received: string[] = [];
  const local = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push(Buffer.concat(chunks).toString());
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
  const localUrl = `http://127.0.0.1:${(local.address() as AddressInfo).port}/in`;

  const auth = { Authorization: `Bearer ${key}` };
  const call = (
    method: string,
    url: string,
    init: Parameters<APIRequestContext["fetch"]>[1] = {},
  ) =>
    request.fetch(`/api/v1${url}`, {
      method,
      ...init,
      headers: { ...auth, ...(init.headers ?? {}) },
    });

  try {
    // Account
    let res = await call("GET", "/me");
    await expectContract(res, "get", "/me");
    expect(res.headers()["ratelimit-limit"]).toBeTruthy();
    expect(Number(res.headers()["ratelimit-remaining"])).toBeGreaterThan(0);
    await expectContract(await call("GET", "/usage"), "get", "/usage");
    await expectContract(await request.get("/api/v1/cli/config"), "get", "/cli/config");
    await expectContract(await request.get("/api/v1/openapi.json"), "get", "/openapi.json");

    // Errors share one shape.
    res = await request.get("/api/v1/endpoints");
    expect(res.status()).toBe(401);
    await expectContract(res, "get", "/endpoints");
    res = await request.get("/api/v1/endpoints", {
      headers: { Authorization: `Bearer ${tunnelOnly}` },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient_scope");
    res = await call("POST", "/endpoints", { data: { name: "" } });
    expect(res.status()).toBe(400);
    await expectContract(res, "post", "/endpoints");

    // Idempotent create.
    const idem = { "Idempotency-Key": `create-${Date.now()}` };
    res = await call("POST", "/endpoints", {
      data: { name: "API endpoint", template: "github" },
      headers: idem,
    });
    expect(res.status()).toBe(201);
    await expectContract(res, "post", "/endpoints");
    const endpoint = (await res.json()) as {
      id: string;
      slug: string;
      url: string;
      signature_provider: string;
    };
    expect(endpoint.signature_provider).toBe("github");
    const again = await call("POST", "/endpoints", {
      data: { name: "API endpoint", template: "github" },
      headers: idem,
    });
    expect(again.status()).toBe(201);
    expect(again.headers()["idempotent-replayed"]).toBe("true");
    expect((await again.json()).id).toBe(endpoint.id);
    res = await call("POST", "/endpoints", { data: { name: "Different" }, headers: idem });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe("idempotency_key_reused");

    res = await call("GET", "/endpoints?limit=1");
    await expectContract(res, "get", "/endpoints");
    await expectContract(
      await call("GET", `/endpoints/${endpoint.slug}`),
      "get",
      "/endpoints/{id}",
    );
    res = await call("PATCH", `/endpoints/${endpoint.id}`, {
      data: { name: "Renamed", retention_hours: 12 },
    });
    await expectContract(res, "patch", "/endpoints/{id}");
    expect((await res.json()).name).toBe("Renamed");
    res = await call("GET", `/endpoints/${endpoint.id}/signature-secret`);
    expect(res.status()).toBe(404);
    await expectContract(res, "get", "/endpoints/{id}/signature-secret");

    // Destinations
    res = await call("POST", `/endpoints/${endpoint.id}/destinations`, {
      data: {
        name: "Local",
        url: localUrl,
        sign_with_standard_webhooks: true,
        filter: { methods: ["POST"] },
      },
    });
    expect(res.status()).toBe(201);
    await expectContract(res, "post", "/endpoints/{id}/destinations");
    const destination = (await res.json()) as { id: string; signing_secret: string };
    expect(destination.signing_secret).toMatch(/^whsec_/);
    await expectContract(
      await call("GET", `/endpoints/${endpoint.id}/destinations`),
      "get",
      "/endpoints/{id}/destinations",
    );
    res = await call("PATCH", `/destinations/${destination.id}`, {
      data: { timeout_ms: 5000, max_attempts: 3 },
    });
    await expectContract(res, "patch", "/destinations/{id}");
    expect((await res.json()).max_attempts).toBe(3);

    // Requests and deliveries
    await request.post(`${endpoint.url}/orders?x=1`, { data: { order: 7 } });
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
    res = await call("GET", `/endpoints/${endpoint.id}/requests?method=POST`);
    await expectContract(res, "get", "/endpoints/{id}/requests");
    const [summary] = (await res.json()).data as { id: string }[];
    if (!summary) throw new Error("no request listed");
    res = await call("GET", `/requests/${summary.id}`);
    await expectContract(res, "get", "/requests/{id}");
    expect(Buffer.from((await res.json()).body_b64, "base64").toString()).toBe('{"order":7}');
    res = await call("GET", `/requests/${summary.id}/body`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('{"order":7}');
    covered.add("get /requests/{id}/body");

    res = await call("GET", "/deliveries?status=succeeded,pending");
    await expectContract(res, "get", "/deliveries");
    const deliveries = (await res.json()).data as { id: string }[];
    expect(deliveries.length).toBeGreaterThan(0);
    res = await call("POST", `/deliveries/${deliveries[0]?.id}/retry`);
    await expectContract(res, "post", "/deliveries/{id}/retry");
    res = await call("POST", `/requests/${summary.id}/replay`, {
      data: { target: { destination_id: destination.id } },
    });
    await expectContract(res, "post", "/requests/{id}/replay");
    expect(res.status()).toBe(202);
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(3);
    res = await call("POST", `/requests/${summary.id}/replay`, { data: { target: "cli" } });
    expect(res.status()).toBe(409);
    await expectContract(res, "post", "/requests/{id}/replay");

    // CLI login endpoints
    res = await request.post("/api/v1/cli/device-codes", { data: { client_name: "contract" } });
    await expectContract(res, "post", "/cli/device-codes");
    const { device_code } = await res.json();
    res = await request.post("/api/v1/cli/device-codes/poll", { data: { device_code } });
    expect(res.status()).toBe(400);
    await expectContract(res, "post", "/cli/device-codes/poll");

    // Deletes
    res = await call("DELETE", `/destinations/${destination.id}`);
    expect(res.status()).toBe(204);
    covered.add("delete /destinations/{id}");
    res = await call("DELETE", `/requests/${summary.id}`);
    expect(res.status()).toBe(204);
    covered.add("delete /requests/{id}");
    res = await call("DELETE", `/endpoints/${endpoint.id}`);
    expect(res.status()).toBe(204);
    covered.add("delete /endpoints/{id}");
    await expectContract(await call("GET", `/endpoints/${endpoint.id}`), "get", "/endpoints/{id}");

    // Logout revokes the key that calls it.
    res = await request.post("/api/v1/cli/logout", {
      headers: { Authorization: `Bearer ${tunnelOnly}` },
    });
    await expectContract(res, "post", "/cli/logout");
    expect(
      (
        await request.get("/api/v1/me", { headers: { Authorization: `Bearer ${tunnelOnly}` } })
      ).status(),
    ).toBe(401);
  } finally {
    local.close();
  }

  expect(operations.filter((op) => !covered.has(op))).toEqual([]);
});

test("keys are rate limited and can be revoked", async ({ page, request }) => {
  const { orgSlug } = await signUpWithOrg(page, request);
  const key = await createKey(page, orgSlug, "Busy", ["endpoints:read"]);
  const headers = { Authorization: `Bearer ${key}` };

  // Concurrent bursts drain the bucket faster than it refills, even on a busy machine.
  let limited = null;
  for (let round = 0; round < 5 && !limited; round++) {
    const answers = await Promise.all(
      Array.from({ length: 150 }, () => request.get("/api/v1/me", { headers })),
    );
    limited = answers.find((r) => r.status() === 429) ?? null;
  }
  if (!limited) throw new Error("the bucket never emptied");
  expect(limited.headers()["retry-after"]).toBeTruthy();
  expect(limited.headers()["ratelimit-remaining"]).toBe("0");
  expect((await limited.json()).error.code).toBe("rate_limited");

  await page.goto(`/${orgSlug}/settings/api-keys`);
  await page.getByTestId("api-key-row").getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByTestId("api-key-row")).toHaveCount(0);
  expect((await request.get("/api/v1/me", { headers })).status()).toBe(401);
});

test("the API reference renders under the content security policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy|Refused to/.test(msg.text()))
      violations.push(msg.text());
  });
  await page.goto("/docs/api");
  await expect(page.getByRole("heading", { name: "Hookline API" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Create an endpoint").first()).toBeVisible();
  expect(violations).toEqual([]);
});
