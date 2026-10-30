import { describe, expect, it, vi } from "vitest";
import { graphSender, parseAddress } from "./graph-mail";

describe("parseAddress", () => {
  it.each([
    ["Hookline <contact@vante.app>", { name: "Hookline", address: "contact@vante.app" }],
    ['"Hookline Team" <a@b.co>', { name: "Hookline Team", address: "a@b.co" }],
    ["<a@b.co>", { address: "a@b.co" }],
    ["a@b.co", { address: "a@b.co" }],
  ])("%s", (input, want) => expect(parseAddress(input)).toEqual(want));
});

describe("graphSender", () => {
  const config = { tenantId: "tenant", clientId: "app-id", clientSecret: "app-secret" };
  const message = {
    from: { name: "Hookline", address: "contact@vante.app" },
    to: "user@example.com",
    subject: "Verify your email for Hookline",
    html: "<p>Hi</p>",
  };

  it("gets an app-only token once and sends as the mailbox", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/token")) {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("client_credentials");
        expect(form.get("scope")).toBe("https://graph.microsoft.com/.default");
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      }
      expect(String(url)).toBe("https://graph.test/v1.0/users/contact%40vante.app/sendMail");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
      const body = JSON.parse(String(init?.body));
      expect(body.message.from.emailAddress).toEqual(message.from);
      expect(body.message.toRecipients[0].emailAddress.address).toBe("user@example.com");
      expect(body.message.body).toEqual({ contentType: "HTML", content: "<p>Hi</p>" });
      return new Response(null, { status: 202 });
    });
    const send = graphSender(config, {
      fetch: fetch as typeof globalThis.fetch,
      tokenUrl: "https://login.test/token",
      apiBase: "https://graph.test/v1.0",
    });
    await send(message);
    await send(message);
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith("/token"))).toHaveLength(1);
  });

  it("surfaces Graph's error message", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/token")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }))
        : new Response(
            JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }),
            {
              status: 403,
            },
          ),
    );
    const send = graphSender(config, {
      fetch: fetch as typeof globalThis.fetch,
      tokenUrl: "https://login.test/token",
      apiBase: "https://graph.test",
    });
    await expect(send(message)).rejects.toThrow(
      "Graph sendMail: 403 ErrorAccessDenied: Access is denied.",
    );
  });
});
