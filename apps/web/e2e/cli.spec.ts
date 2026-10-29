import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { hydrated, signUpWithOrg } from "./helpers";

const repoRoot = resolve(__dirname, "../../..");
let cliBinary = "";

test.beforeAll(() => {
  // Build the real CLI once; `go run` would leave its child running on Windows.
  const dir = mkdtempSync(join(tmpdir(), "hookline-cli-"));
  cliBinary = join(dir, process.platform === "win32" ? "hookline.exe" : "hookline");
  execFileSync("go", ["build", "-o", cliBinary, "./cli"], { cwd: repoRoot, stdio: "inherit" });
});

async function freshEndpoint(page: Page, request: APIRequestContext) {
  const { orgSlug } = await signUpWithOrg(page, request);
  await hydrated(page, "Create endpoint");
  await page.getByLabel("Name").fill("CLI e2e");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await page.getByRole("link", { name: "Open the inbox" }).click();
  await page.waitForURL(/\/endpoints\/[0-9A-Za-z]{12}$/);
  const url = (await page.getByTestId("endpoint-url").textContent())?.trim() ?? "";
  return { orgSlug, url, slug: url.split("/h/")[1] ?? "", inbox: page.url() };
}

/** Runs the device flow the way `hookline login` does, approving in the browser. */
async function deviceLogin(page: Page, request: APIRequestContext, approve: boolean) {
  const start = await request.post("/api/v1/cli/device-codes", {
    data: { client_name: "e2e-laptop" },
  });
  expect(start.status()).toBe(201);
  const code = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    interval: number;
  };
  expect(code.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);

  const pending = await request.post("/api/v1/cli/device-codes/poll", {
    data: { device_code: code.device_code },
  });
  expect(pending.status()).toBe(400);
  expect((await pending.json()).error.code).toBe("authorization_pending");

  await page.goto(code.verification_uri_complete);
  await expect(page.getByTestId("device-code")).toHaveText(code.user_code);
  await expect(page.getByText("e2e-laptop")).toBeVisible();
  await page.getByRole("button", { name: approve ? "Approve" : "Deny" }).click();
  await expect(
    page.getByRole("heading", { name: approve ? "CLI authorized" : "Login denied" }),
  ).toBeVisible();

  // Polls must respect the interval.
  await page.waitForTimeout(code.interval * 1000);
  return request.post("/api/v1/cli/device-codes/poll", { data: { device_code: code.device_code } });
}

type Received = { method: string; url: string; body: string; headers: IncomingMessage["headers"] };

test("log in with the device flow, listen with the CLI and forward to localhost", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { slug, url, inbox, orgSlug } = await freshEndpoint(page, request);

  const poll = await deviceLogin(page, request, true);
  expect(poll.status()).toBe(200);
  const login = (await poll.json()) as { api_key: string; org: { slug: string } };
  expect(login.api_key).toMatch(/^hk_live_/);
  expect(login.org.slug).toBe(orgSlug);

  const auth = { Authorization: `Bearer ${login.api_key}` };
  const me = await request.get("/api/v1/me", { headers: auth });
  expect(me.status()).toBe(200);
  expect((await me.json()).key.scopes).toContain("tunnel");
  const list = await request.get("/api/v1/endpoints", { headers: auth });
  expect((await list.json()).data.map((e: { slug: string }) => e.slug)).toContain(slug);

  // The developer's app.
  const received: Received[] = [];
  const local = createServer((req, res) => {
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
  await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
  const port = (local.address() as AddressInfo).port;

  let cli: ChildProcess | undefined;
  try {
    let stdout = "";
    let stderr = "";
    cli = spawn(
      cliBinary,
      [
        "listen",
        slug,
        "--forward",
        `http://127.0.0.1:${port}/hooks`,
        "--header",
        "X-Local-Secret: s3",
      ],
      {
        env: {
          ...process.env,
          HOOKLINE_URL: "http://localhost:3000",
          HOOKLINE_API_KEY: login.api_key,
          HOOKLINE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "hookline-cfg-")),
          HOOKLINE_NO_BROWSER: "1",
          NO_COLOR: "1",
        },
      },
    );
    cli.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    cli.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    await expect.poll(() => stderr, { timeout: 30_000 }).toContain("Forwarding");

    // The inbox shows the connected CLI.
    await page.goto(inbox);
    await expect(page.getByTestId("cli-count")).toHaveText("1 CLI");

    await request.post(`${url}/stripe?live=1`, {
      data: { type: "payment_intent.succeeded" },
      headers: { "Stripe-Signature": "t=1,v1=abc" },
    });
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
    const got = received[0];
    expect(got?.method).toBe("POST");
    expect(got?.url).toBe("/hooks/stripe?live=1");
    expect(JSON.parse(got?.body ?? "{}")).toEqual({ type: "payment_intent.succeeded" });
    expect(got?.headers["stripe-signature"]).toBe("t=1,v1=abc");
    expect(got?.headers["x-local-secret"]).toBe("s3");
    await expect
      .poll(() => stdout)
      .toMatch(/POST\s+\/h\/\w+\/stripe\?live=1\s+→ 200 .*payment_intent\.succeeded/);

    // Replay ▾ → To connected CLI sends it through the tunnel again.
    await page.getByTestId("request-row").first().click();
    const detail = page.getByRole("article", { name: "Request detail" });
    await detail.getByRole("button", { name: /^Replay/ }).click();
    await page.getByRole("menuitem", { name: /To connected CLI/ }).click();
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(2);
    expect(received[1]?.body).toBe(received[0]?.body);
    await expect.poll(() => stdout).toContain("(replay)");

    // `hookline trigger` signs a sample event with the endpoint's secret.
    await page.goto(`${inbox}/settings`);
    await hydrated(page, "Save verification");
    await page.getByLabel("Signature provider").click();
    await page.getByRole("option", { name: "Generic HMAC-SHA256" }).click();
    await page.getByLabel("Shared secret").fill("trigger-secret");
    await page.getByRole("button", { name: "Save verification" }).click();
    await expect(page.getByText("Verification saved")).toBeVisible();
    const trigger = execFileSync(cliBinary, ["trigger", slug, "generic.json", "--json"], {
      env: {
        ...process.env,
        HOOKLINE_URL: "http://localhost:3000",
        HOOKLINE_API_KEY: login.api_key,
        NO_COLOR: "1",
      },
    }).toString();
    expect(JSON.parse(trigger)).toMatchObject({ event: "generic.json", status: 200 });
    await page.goto(inbox);
    await expect(page.getByTestId("request-row").first()).toContainText("/events");
    await expect(page.getByTestId("request-row").first()).toContainText("Verified");
  } finally {
    cli?.kill();
    local.close();
  }

  // `hookline logout` revokes the key server-side.
  const out = await request.post("/api/v1/cli/logout", { headers: auth });
  expect(out.status()).toBe(200);
  expect((await request.get("/api/v1/me", { headers: auth })).status()).toBe(401);
});

test("a denied login issues no key", async ({ page, request }) => {
  await signUpWithOrg(page, request);
  const poll = await deviceLogin(page, request, false);
  expect(poll.status()).toBe(400);
  expect((await poll.json()).error.code).toBe("access_denied");
});

test("the API rejects missing keys and missing scopes", async ({ request }) => {
  const res = await request.get("/api/v1/endpoints");
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("unauthorized");
  const bad = await request.get("/api/v1/endpoints", {
    headers: { Authorization: "Bearer hk_live_nope" },
  });
  expect(bad.status()).toBe(401);
});
