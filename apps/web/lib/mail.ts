import "server-only";
import { render } from "@react-email/render";
import { after } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";
import type { ReactElement } from "react";
import { env } from "./env";

let transport: Transporter | undefined;

function transporter(): Transporter {
  transport ??= nodemailer.createTransport(env().SMTP_URL);
  return transport;
}

type Message = { to: string; subject: string; body: ReactElement };

/** Renders a React Email template to HTML and plain text and sends it. */
export async function sendEmail({ to, subject, body }: Message): Promise<void> {
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
