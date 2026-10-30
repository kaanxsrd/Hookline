import "server-only";
import { render } from "@react-email/render";
import { after } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";
import type { ReactElement } from "react";
import { env } from "./env";
import { graphSender, parseAddress } from "./graph-mail";

let transport: Transporter | undefined;
let graph: ReturnType<typeof graphSender> | undefined;

function transporter(): Transporter {
  transport ??= nodemailer.createTransport(env().SMTP_URL);
  return transport;
}

/** Microsoft Graph when its three settings are present, otherwise SMTP. */
function graphMailer(): ReturnType<typeof graphSender> | undefined {
  const { MS_GRAPH_TENANT_ID: tenantId, MS_GRAPH_CLIENT_ID: clientId } = env();
  const clientSecret = env().MS_GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return undefined;
  graph ??= graphSender({ tenantId, clientId, clientSecret });
  return graph;
}

type Message = { to: string; subject: string; body: ReactElement };

/** Renders a React Email template to HTML and plain text and sends it. */
export async function sendEmail({ to, subject, body }: Message): Promise<void> {
  const viaGraph = graphMailer();
  if (viaGraph) {
    // Graph takes one body; the HTML version carries everything.
    await viaGraph({ from: parseAddress(env().MAIL_FROM), to, subject, html: await render(body) });
    return;
  }
  const [html, text] = await Promise.all([render(body), render(body, { plainText: true })]);
  await transporter().sendMail({ from: env().MAIL_FROM, to, subject, html, text });
}

/**
 * Sends without blocking the caller. Used where awaiting would make response
 * times reveal whether an account exists (password resets) and for
 * notifications that must never fail the request that triggered them.
 */
export function sendEmailInBackground(message: Message): void {
  const send = () =>
    sendEmail(message).catch((error: unknown) => {
      console.error("email delivery failed", { subject: message.subject, error });
    });
  try {
    // Runs once the response is sent, and keeps serverless functions (Vercel)
    // alive until it finishes instead of freezing them mid-send.
    after(send);
  } catch {
    // Outside a request (scripts, tests): nothing to wait for.
    void send();
  }
}
