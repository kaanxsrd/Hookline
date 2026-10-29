/**
 * Realistic webhook requests for the development seed. Payload shapes and
 * headers follow each provider's documentation; every identifier, email and
 * address is synthetic (example.com, TEST-NET ranges, demo shop).
 * Signatures are real HMACs over the body with the demo secrets below.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { Pair } from "../schema/columns";

/** Demo signing secrets, so signature verification can be exercised locally. */
export const DEMO_SECRETS = {
  stripe: "whsec_hooklineDemoStripeSecret0000",
  github: "hookline-demo-github-secret",
  shopify: "hookline-demo-shopify-secret",
} as const;

export type Fixture = {
  method: string;
  path: string;
  query: Pair[];
  headers: Pair[];
  contentType: string | null;
  body: Buffer;
  sourceIp: string;
  userAgent: string | null;
};

/** Small deterministic PRNG (mulberry32) so the seed is stable across runs. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  };
  const alnum = (n: number) => {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let s = "";
    for (let i = 0; i < n; i++) s += chars[Math.floor(next() * chars.length)];
    return s;
  };
  return { next, int, pick, alnum };
}

export type Rng = ReturnType<typeof createRng>;

const customers = [
  { name: "Jane Cooper", email: "jane.cooper@example.com", city: "Austin", country: "US" },
  { name: "Liam Nguyen", email: "liam.nguyen@example.com", city: "Toronto", country: "CA" },
  { name: "Sofia Rossi", email: "sofia.rossi@example.com", city: "Milan", country: "IT" },
  { name: "Noah Schmidt", email: "noah.schmidt@example.com", city: "Berlin", country: "DE" },
  { name: "Aiko Tanaka", email: "aiko.tanaka@example.com", city: "Osaka", country: "JP" },
  { name: "Emma Larsen", email: "emma.larsen@example.com", city: "Copenhagen", country: "DK" },
] as const;

const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const hmacHex = (secret: string, data: string | Buffer) =>
  createHmac("sha256", secret).update(data).digest("hex");
const hmacBase64 = (secret: string, data: string | Buffer) =>
  createHmac("sha256", secret).update(data).digest("base64");

function baseHeaders(host: string, body: Buffer, extra: Pair[]): Pair[] {
  return [
    ["Host", host],
    ...extra,
    ["Content-Length", String(body.length)],
    ["Accept-Encoding", "gzip"],
  ];
}

// --- Stripe -----------------------------------------------------------------

/** Stripe's published webhook source addresses. */
const stripeIps = [
  "3.18.12.63",
  "3.130.192.231",
  "13.235.14.237",
  "18.211.135.69",
  "54.187.174.169",
];

export const stripeEventTypes = [
  "payment_intent.succeeded",
  "charge.succeeded",
  "checkout.session.completed",
  "customer.subscription.created",
  "invoice.paid",
  "payment_intent.payment_failed",
] as const;

function stripeObject(type: (typeof stripeEventTypes)[number], rng: Rng, created: number) {
  const customer = rng.pick(customers);
  const amount = rng.pick([999, 1900, 2900, 4999, 12900, 49900]);
  const cus = `cus_${rng.alnum(14)}`;
  const pi = `pi_3Q${rng.alnum(22)}`;
  switch (type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const failed = type === "payment_intent.payment_failed";
      return {
        id: pi,
        object: "payment_intent",
        amount,
        amount_received: failed ? 0 : amount,
        currency: "usd",
        customer: cus,
        description: "Hookline Pro (monthly)",
        latest_charge: failed ? null : `ch_3Q${rng.alnum(22)}`,
        last_payment_error: failed
          ? {
              code: "card_declined",
              decline_code: "insufficient_funds",
              message: "Your card has insufficient funds.",
              type: "card_error",
            }
          : null,
        livemode: false,
        metadata: { order_id: `ord_${rng.int(10000, 99999)}` },
        payment_method_types: ["card"],
        receipt_email: customer.email,
        status: failed ? "requires_payment_method" : "succeeded",
        created,
      };
    }
    case "charge.succeeded":
      return {
        id: `ch_3Q${rng.alnum(22)}`,
        object: "charge",
        amount,
        amount_captured: amount,
        currency: "usd",
        customer: cus,
        paid: true,
        payment_intent: pi,
        payment_method_details: {
          type: "card",
          card: {
            brand: rng.pick(["visa", "mastercard", "amex"]),
            last4: "4242",
            exp_month: 12,
            exp_year: 2029,
          },
        },
        billing_details: { email: customer.email, name: customer.name },
        receipt_url: `https://pay.stripe.com/receipts/payment/${rng.alnum(40)}`,
        status: "succeeded",
        created,
      };
    case "checkout.session.completed":
      return {
        id: `cs_test_${rng.alnum(58)}`,
        object: "checkout.session",
        amount_subtotal: amount,
        amount_total: amount,
        currency: "usd",
        customer: cus,
        customer_details: {
          email: customer.email,
          name: customer.name,
          address: { city: customer.city, country: customer.country },
        },
        mode: "subscription",
        payment_status: "paid",
        status: "complete",
        subscription: `sub_1Q${rng.alnum(22)}`,
        success_url: "https://shop.example.com/checkout/success",
        created,
      };
    case "customer.subscription.created":
      return {
        id: `sub_1Q${rng.alnum(22)}`,
        object: "subscription",
        customer: cus,
        status: "active",
        cancel_at_period_end: false,
        current_period_start: created,
        current_period_end: created + 30 * 86400,
        items: {
          object: "list",
          data: [
            {
              id: `si_${rng.alnum(14)}`,
              price: {
                id: `price_1Q${rng.alnum(22)}`,
                unit_amount: amount,
                currency: "usd",
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
          ],
        },
        created,
      };
    case "invoice.paid":
      return {
        id: `in_1Q${rng.alnum(22)}`,
        object: "invoice",
        amount_due: amount,
        amount_paid: amount,
        currency: "usd",
        customer: cus,
        customer_email: customer.email,
        hosted_invoice_url: `https://invoice.stripe.com/i/acct_${rng.alnum(16)}/test_${rng.alnum(40)}`,
        number: `HKL-${rng.int(1000, 9999)}`,
        paid: true,
        status: "paid",
        subscription: `sub_1Q${rng.alnum(22)}`,
        created,
      };
  }
}

export function stripeFixture(rng: Rng, at: Date): Fixture {
  const type = rng.pick(stripeEventTypes);
  const created = Math.floor(at.getTime() / 1000);
  const body = json({
    id: `evt_3Q${rng.alnum(22)}`,
    object: "event",
    api_version: "2025-09-30.clover",
    created,
    data: { object: stripeObject(type, rng, created) },
    livemode: false,
    pending_webhooks: 1,
    request: { id: `req_${rng.alnum(14)}`, idempotency_key: randomUUID() },
    type,
  });
  const signature = `t=${created},v1=${hmacHex(DEMO_SECRETS.stripe, `${created}.${body.toString()}`)}`;
  const userAgent = "Stripe/1.0 (+https://stripe.com/docs/webhooks)";
  return {
    method: "POST",
    path: "/",
    query: [],
    headers: baseHeaders("localhost:8080", body, [
      ["User-Agent", userAgent],
      ["Accept", "*/*; q=0.5, application/xml"],
      ["Cache-Control", "no-cache"],
      ["Content-Type", "application/json; charset=utf-8"],
      ["Stripe-Signature", signature],
    ]),
    contentType: "application/json; charset=utf-8",
    body,
    sourceIp: rng.pick(stripeIps),
    userAgent,
  };
}

// --- GitHub -----------------------------------------------------------------

export const githubEvents = ["push", "pull_request", "issues", "star", "ping"] as const;

const repo = {
  id: 812345678,
  node_id: "R_kgDOMG1Xzg",
  name: "storefront",
  full_name: "acme-labs/storefront",
  private: false,
  html_url: "https://github.com/acme-labs/storefront",
  default_branch: "main",
  owner: { login: "acme-labs", id: 98765432, type: "Organization" },
};
const githubUsers = ["octo-dev", "mira-k", "devon-ops", "sam-builds"] as const;

function githubPayload(event: (typeof githubEvents)[number], rng: Rng, at: Date) {
  const sender = { login: rng.pick(githubUsers), id: rng.int(1_000_000, 9_999_999), type: "User" };
  const sha = () => Array.from({ length: 40 }, () => "0123456789abcdef"[rng.int(0, 15)]).join("");
  switch (event) {
    case "push": {
      const after = sha();
      const messages = [
        "Fix webhook retry backoff",
        "Add checkout success page",
        "Bump dependencies",
        "Refactor order totals",
        "Handle refunds in billing service",
      ];
      return {
        ref: "refs/heads/main",
        before: sha(),
        after,
        created: false,
        deleted: false,
        forced: false,
        compare: `https://github.com/acme-labs/storefront/compare/${after.slice(0, 12)}`,
        commits: [
          {
            id: after,
            message: rng.pick(messages),
            timestamp: at.toISOString(),
            author: { name: sender.login, email: `${sender.login}@users.noreply.github.com` },
            added: [],
            removed: [],
            modified: ["src/checkout.ts"],
          },
        ],
        head_commit: { id: after, timestamp: at.toISOString() },
        repository: repo,
        pusher: { name: sender.login, email: `${sender.login}@users.noreply.github.com` },
        sender,
      };
    }
    case "pull_request": {
      const number = rng.int(100, 400);
      return {
        action: "opened",
        number,
        pull_request: {
          id: rng.int(1_000_000_000, 2_000_000_000),
          number,
          state: "open",
          title: rng.pick([
            "Add Stripe tax support",
            "Speed up product search",
            "Fix flaky e2e test",
          ]),
          html_url: `https://github.com/acme-labs/storefront/pull/${number}`,
          user: sender,
          draft: false,
          head: { ref: `feature/${rng.alnum(6).toLowerCase()}`, sha: sha() },
          base: { ref: "main", sha: sha() },
          additions: rng.int(5, 400),
          deletions: rng.int(0, 120),
          changed_files: rng.int(1, 14),
          created_at: at.toISOString(),
        },
        repository: repo,
        sender,
      };
    }
    case "issues": {
      const number = rng.int(100, 400);
      return {
        action: "opened",
        issue: {
          id: rng.int(1_000_000_000, 2_000_000_000),
          number,
          title: rng.pick([
            "Checkout fails on Safari",
            "Add dark mode to emails",
            "Orders export times out",
          ]),
          state: "open",
          html_url: `https://github.com/acme-labs/storefront/issues/${number}`,
          user: sender,
          labels: [{ name: "bug", color: "d73a4a" }],
          created_at: at.toISOString(),
        },
        repository: repo,
        sender,
      };
    }
    case "star":
      return { action: "created", starred_at: at.toISOString(), repository: repo, sender };
    case "ping":
      return {
        zen: "Design for failure.",
        hook_id: 501234567,
        hook: {
          type: "Repository",
          id: 501234567,
          active: true,
          events: ["push", "pull_request", "issues", "star"],
        },
        repository: repo,
        sender,
      };
  }
}

export function githubFixture(rng: Rng, at: Date): Fixture {
  const event = rng.pick(githubEvents);
  const body = json(githubPayload(event, rng, at));
  const userAgent = "GitHub-Hookshot/8f2d1a3";
  return {
    method: "POST",
    path: "/",
    query: [],
    headers: baseHeaders("localhost:8080", body, [
      ["Accept", "*/*"],
      ["Content-Type", "application/json"],
      ["User-Agent", userAgent],
      ["X-GitHub-Delivery", randomUUID()],
      ["X-GitHub-Event", event],
      ["X-GitHub-Hook-ID", "501234567"],
      ["X-GitHub-Hook-Installation-Target-ID", String(repo.id)],
      ["X-GitHub-Hook-Installation-Target-Type", "repository"],
      ["X-Hub-Signature-256", `sha256=${hmacHex(DEMO_SECRETS.github, body)}`],
    ]),
    contentType: "application/json",
    body,
    sourceIp: `140.82.115.${rng.int(2, 250)}`,
    userAgent,
  };
}

// --- Shopify ----------------------------------------------------------------

export const shopifyTopics = [
  "orders/create",
  "orders/paid",
  "products/update",
  "customers/create",
] as const;

const products = [
  { id: 8123456789012, title: "Merino Crew Sweater", price: "89.00", sku: "MCS-NVY-M" },
  { id: 8123456789013, title: "Canvas Weekender Bag", price: "129.00", sku: "CWB-OLV" },
  { id: 8123456789014, title: "Ceramic Pour-Over Set", price: "48.00", sku: "CPO-WHT" },
] as const;

function shopifyPayload(topic: (typeof shopifyTopics)[number], rng: Rng, at: Date) {
  const customer = rng.pick(customers);
  const [first = "", last = ""] = customer.name.split(" ");
  const product = rng.pick(products);
  const quantity = rng.int(1, 3);
  const total = (Number(product.price) * quantity).toFixed(2);
  switch (topic) {
    case "orders/create":
    case "orders/paid": {
      const orderNumber = rng.int(1001, 1999);
      return {
        id: rng.int(5_000_000_000, 5_999_999_999) * 1000 + rng.int(0, 999),
        admin_graphql_api_id: `gid://shopify/Order/${rng.int(5_000_000_000, 5_999_999_999)}`,
        name: `#${orderNumber}`,
        order_number: orderNumber,
        email: customer.email,
        created_at: at.toISOString(),
        currency: "USD",
        financial_status: topic === "orders/paid" ? "paid" : "pending",
        fulfillment_status: null,
        subtotal_price: total,
        total_price: total,
        total_tax: "0.00",
        line_items: [
          {
            id: rng.int(10_000_000_000, 19_999_999_999),
            product_id: product.id,
            title: product.title,
            sku: product.sku,
            price: product.price,
            quantity,
          },
        ],
        customer: {
          id: rng.int(7_000_000_000, 7_999_999_999),
          email: customer.email,
          first_name: first,
          last_name: last,
        },
        shipping_address: {
          first_name: first,
          last_name: last,
          city: customer.city,
          country_code: customer.country,
        },
      };
    }
    case "products/update":
      return {
        id: product.id,
        admin_graphql_api_id: `gid://shopify/Product/${product.id}`,
        title: product.title,
        handle: product.title.toLowerCase().replaceAll(" ", "-"),
        status: "active",
        updated_at: at.toISOString(),
        variants: [
          {
            id: product.id + 1000,
            sku: product.sku,
            price: product.price,
            inventory_quantity: rng.int(0, 250),
          },
        ],
      };
    case "customers/create":
      return {
        id: rng.int(7_000_000_000, 7_999_999_999),
        email: customer.email,
        first_name: first,
        last_name: last,
        created_at: at.toISOString(),
        verified_email: true,
        email_marketing_consent: { state: "subscribed", opt_in_level: "single_opt_in" },
        default_address: { city: customer.city, country_code: customer.country },
      };
  }
}

export function shopifyFixture(rng: Rng, at: Date): Fixture {
  const topic = rng.pick(shopifyTopics);
  const body = json(shopifyPayload(topic, rng, at));
  const userAgent = "Shopify-Captain-Hook";
  return {
    method: "POST",
    path: "/",
    query: [],
    headers: baseHeaders("localhost:8080", body, [
      ["Content-Type", "application/json"],
      ["User-Agent", userAgent],
      ["X-Shopify-API-Version", "2026-07"],
      ["X-Shopify-Event-Id", randomUUID()],
      ["X-Shopify-Hmac-Sha256", hmacBase64(DEMO_SECRETS.shopify, body)],
      ["X-Shopify-Shop-Domain", "hookline-demo-store.myshopify.com"],
      ["X-Shopify-Topic", topic],
      ["X-Shopify-Triggered-At", at.toISOString()],
      ["X-Shopify-Webhook-Id", randomUUID()],
    ]),
    contentType: "application/json",
    body,
    sourceIp: `35.188.${rng.int(0, 255)}.${rng.int(1, 254)}`,
    userAgent,
  };
}

// --- Generic ----------------------------------------------------------------

/** A spread of shapes: forms, query-only GETs, XML, text, binary and auth headers. */
export function genericFixture(rng: Rng, _at: Date): Fixture {
  const ip = `${rng.pick(["203.0.113", "198.51.100", "192.0.2"])}.${rng.int(1, 254)}`;
  const kind = rng.int(0, 5);
  const plain = (
    method: string,
    path: string,
    contentType: string | null,
    body: Buffer,
    userAgent: string,
    query: Pair[] = [],
    extra: Pair[] = [],
  ): Fixture => ({
    method,
    path,
    query,
    headers: baseHeaders("localhost:8080", body, [
      ["User-Agent", userAgent],
      ["Accept", "*/*"],
      ...(contentType ? ([["Content-Type", contentType]] as Pair[]) : []),
      ...extra,
    ]),
    contentType,
    body,
    sourceIp: ip,
    userAgent,
  });

  switch (kind) {
    case 0: {
      const customer = rng.pick(customers);
      const form = new URLSearchParams({
        name: customer.name,
        email: customer.email,
        plan: rng.pick(["starter", "growth"]),
        newsletter: "on",
      });
      return plain(
        "POST",
        "/signup",
        "application/x-www-form-urlencoded",
        Buffer.from(form.toString()),
        "curl/8.11.1",
      );
    }
    case 1:
      return plain("GET", "/status", null, Buffer.alloc(0), "Go-http-client/1.1", [
        ["check", "uptime"],
        ["region", rng.pick(["eu-west-1", "us-east-1"])],
        ["attempt", String(rng.int(1, 3))],
      ]);
    case 2:
      return plain(
        "POST",
        "/payments/notify",
        "application/xml",
        Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>\n<notification><id>${rng.alnum(16)}</id><status>SETTLED</status><amount currency="EUR">${rng.int(10, 500)}.00</amount><reference>INV-${rng.int(1000, 9999)}</reference></notification>`,
        ),
        "PaymentsGateway/3.2",
      );
    case 3:
      return plain(
        "PUT",
        `/devices/${rng.alnum(8)}`,
        "application/json",
        json({
          firmware: "2.4.1",
          battery: rng.int(5, 100),
          temperature_c: rng.int(18, 31),
          online: true,
        }),
        "python-requests/2.32.3",
        [],
        [["Authorization", `Bearer ${rng.alnum(40)}`]],
      );
    case 4:
      return plain(
        "POST",
        "/logs",
        "text/plain; charset=utf-8",
        Buffer.from(
          `deploy finished in ${rng.int(30, 300)}s ✅ (build ${rng.alnum(7).toLowerCase()})\n`,
        ),
        "curl/8.11.1",
      );
    default: {
      // A 1x1 transparent PNG: exercises the hex viewer for binary bodies.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      );
      return plain("POST", "/uploads/avatar", "image/png", png, "okhttp/4.12.0", [
        ["user", String(rng.int(100, 999))],
      ]);
    }
  }
}
