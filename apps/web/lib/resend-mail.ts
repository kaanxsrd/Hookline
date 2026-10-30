/**
 * Sends email through Resend's HTTPS API, for hosts that block outbound SMTP
 * (Railway below the Pro plan). The worker has a Go twin in
 * packages/gocommon/mail/resend.go.
 */

export type ResendMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

type Fetch = typeof fetch;

export function resendSender(
  apiKey: string,
  opts: { fetch?: Fetch; url?: string } = {},
): (message: ResendMessage) => Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  const url = opts.url ?? "https://api.resend.com/emails";

  return async function send(message) {
    const res = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...message, to: [message.to] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return;
    const body = await res.text();
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { name?: string; message?: string };
      if (j.message) detail = `${j.name ?? "error"}: ${j.message}`;
    } catch {
      // not JSON: keep the raw text
    }
    throw new Error(`Resend: ${res.status} ${detail}`);
  };
}
