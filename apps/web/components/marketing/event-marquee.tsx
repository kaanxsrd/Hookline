"use client";

import { InfiniteMovingCards } from "@/components/aceternity/infinite-moving-cards";

const EVENTS = [
  {
    provider: "Stripe",
    color: "bg-indigo-400",
    event: "payment_intent.succeeded",
    status: 200,
    ms: 38,
  },
  { provider: "GitHub", color: "bg-zinc-300", event: "pull_request.opened", status: 202, ms: 51 },
  { provider: "Shopify", color: "bg-emerald-400", event: "orders/create", status: 200, ms: 29 },
  { provider: "Slack", color: "bg-fuchsia-400", event: "event_callback", status: 200, ms: 17 },
  { provider: "Discord", color: "bg-violet-400", event: "INTERACTION_CREATE", status: 200, ms: 22 },
  {
    provider: "Standard Webhooks",
    color: "bg-cyan-400",
    event: "invoice.paid",
    status: 200,
    ms: 33,
  },
  {
    provider: "Stripe",
    color: "bg-indigo-400",
    event: "checkout.session.completed",
    status: 200,
    ms: 21,
  },
  { provider: "GitHub", color: "bg-zinc-300", event: "push", status: 500, ms: 112 },
];

/** A looping band of webhook events as Hookline captures them. */
export function EventMarquee() {
  return (
    <InfiniteMovingCards
      speed="slow"
      items={EVENTS.map((e, i) => ({
        id: `${e.provider}-${e.event}-${i}`,
        content: (
          <div className="bg-card/70 flex items-center gap-3 rounded-lg border px-4 py-2.5 font-mono text-xs backdrop-blur">
            <span className={`size-2 rounded-full ${e.color}`} aria-hidden />
            <span className="text-muted-foreground">{e.provider}</span>
            <span>{e.event}</span>
            <span className={e.status < 300 ? "text-emerald-500" : "text-red-500"}>{e.status}</span>
            <span className="text-muted-foreground">{e.ms} ms</span>
          </div>
        ),
      }))}
    />
  );
}
