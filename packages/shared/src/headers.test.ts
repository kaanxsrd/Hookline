import { describe, expect, test } from "bun:test";
import { isSensitiveHeader, MASKED_VALUE, maskHeaders } from "./headers";

describe("isSensitiveHeader", () => {
  test.each([
    "Authorization",
    "cookie",
    "Stripe-Signature",
    "X-Hub-Signature-256",
    "X-Shopify-Hmac-Sha256",
    "X-Slack-Signature",
    "X-Gitlab-Token",
    "X-Api-Key",
    "Webhook-Secret",
  ])("%s is sensitive", (name) => {
    expect(isSensitiveHeader(name)).toBe(true);
  });

  test.each(["Content-Type", "User-Agent", "X-GitHub-Event", "Host", "Accept"])(
    "%s is not sensitive",
    (name) => {
      expect(isSensitiveHeader(name)).toBe(false);
    },
  );
});

test("maskHeaders keeps order and names", () => {
  expect(
    maskHeaders([
      ["Content-Type", "application/json"],
      ["Authorization", "Bearer abc"],
    ]),
  ).toEqual([
    ["Content-Type", "application/json"],
    ["Authorization", MASKED_VALUE],
  ]);
});
