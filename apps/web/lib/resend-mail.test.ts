import { describe, expect, it, vi } from "vitest";
import { resendSender } from "./resend-mail";

const message = {
  from: "Hookline <contact@vante.app>",
  to: "user@example.com",
  subject: "Verify your email for Hookline",
  html: "<p>Hi</p>",
  text: "Hi",
};

describe("resendSender", () => {
  it("posts the message with the API key", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://resend.test/emails");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer re_test");
      expect(JSON.parse(String(init?.body))).toEqual({ ...message, to: ["user@example.com"] });
      return new Response(JSON.stringify({ id: "1" }));
    });
    await resendSender("re_test", {
      fetch: fetch as typeof globalThis.fetch,
      url: "https://resend.test/emails",
    })(message);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("surfaces Resend's error message", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: "validation_error",
            message: "The vante.app domain is not verified.",
          }),
          { status: 403 },
        ),
    );
    const send = resendSender("re_test", { fetch: fetch as typeof globalThis.fetch });
    await expect(send(message)).rejects.toThrow(
      "Resend: 403 validation_error: The vante.app domain is not verified.",
    );
  });
});
