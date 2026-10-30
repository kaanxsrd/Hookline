/**
 * Sends email through Microsoft Graph's sendMail over HTTPS, as a Microsoft
 * 365 mailbox, for hosts that block outbound SMTP (Railway below the Pro
 * plan). The worker has a Go twin in packages/gocommon/mail/graph.go.
 */

export type GraphConfig = { tenantId: string; clientId: string; clientSecret: string };

export type GraphMessage = {
  from: { name?: string; address: string };
  to: string;
  subject: string;
  html: string;
};

type Fetch = typeof fetch;

/** "Name <addr@example.com>" or "addr@example.com". */
export function parseAddress(value: string): { name?: string; address: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  if (m?.[2]) {
    const name = (m[1] ?? "").replace(/^"(.*)"$/, "$1").trim();
    return name ? { name, address: m[2] } : { address: m[2] };
  }
  return { address: value.trim() };
}

function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as {
      error?: string | { code?: string; message?: string };
      error_description?: string;
    };
    if (j.error_description) return j.error_description.split("\r\n")[0] ?? "";
    if (typeof j.error === "object") return `${j.error.code}: ${j.error.message}`;
    return String(j.error ?? body);
  } catch {
    return body.slice(0, 300);
  }
}

/** A Graph sender with an app-only token cached until a minute before it expires. */
export function graphSender(
  config: GraphConfig,
  opts: { fetch?: Fetch; tokenUrl?: string; apiBase?: string; now?: () => number } = {},
) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const tokenUrl =
    opts.tokenUrl ??
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const apiBase = opts.apiBase ?? "https://graph.microsoft.com/v1.0";
  let cached: { token: string; expires: number } | undefined;

  async function token(): Promise<string> {
    if (cached && now() < cached.expires) return cached.token;
    const res = await doFetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Graph token: ${res.status} ${errorText(text)}`);
    const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Graph token: no access token in the response");
    cached = { token: body.access_token, expires: now() + ((body.expires_in ?? 3600) - 60) * 1000 };
    return cached.token;
  }

  return async function send(message: GraphMessage): Promise<void> {
    const res = await doFetch(
      `${apiBase}/users/${encodeURIComponent(message.from.address)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            from: { emailAddress: message.from },
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (res.status === 202) return;
    if (res.status === 401) cached = undefined; // revoked or rotated: fetch a new token next time
    throw new Error(`Graph sendMail: ${res.status} ${errorText(await res.text())}`);
  };
}
