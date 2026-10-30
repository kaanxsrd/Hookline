"use client";

import { Activity, Braces, Inbox, Repeat, Send, ShieldCheck, Terminal, Users } from "lucide-react";
import { HoverEffect } from "@/components/aceternity/card-hover-effect";

const icon = (Icon: typeof Inbox) => <Icon className="size-5" aria-hidden />;

/** The guides, as cards with a highlight that glides between them. */
export function DocsCards() {
  return (
    <HoverEffect
      className="not-prose -mx-2 my-6 lg:grid-cols-2"
      items={[
        {
          href: "/docs/endpoints",
          title: "Endpoints",
          description: "URLs, custom responses, retention and templates.",
          icon: icon(Inbox),
        },
        {
          href: "/docs/inbox",
          title: "Inbox",
          description: "Filters, search, body views and keyboard shortcuts.",
          icon: icon(Activity),
        },
        {
          href: "/docs/cli",
          title: "CLI and tunnels",
          description: "Pipe webhooks to localhost, replay and send test events.",
          icon: icon(Terminal),
        },
        {
          href: "/docs/destinations",
          title: "Destinations",
          description: "Forward to your servers with filters, retries and signatures.",
          icon: icon(Send),
        },
        {
          href: "/docs/replay",
          title: "Replay",
          description: "Send any captured request again, as captured or edited.",
          icon: icon(Repeat),
        },
        {
          href: "/docs/signatures",
          title: "Signature verification",
          description: "Check that Stripe, GitHub and others really sent it.",
          icon: icon(ShieldCheck),
        },
        {
          href: "/docs/rest-api",
          title: "REST API",
          description: "Automate everything with a scoped API key.",
          icon: icon(Braces),
        },
        {
          href: "/docs/organizations",
          title: "Organizations and roles",
          description: "Share endpoints with your team, with an audit log.",
          icon: icon(Users),
        },
      ]}
    />
  );
}
