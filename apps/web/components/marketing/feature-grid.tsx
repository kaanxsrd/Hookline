"use client";

import {
  Activity,
  CircleCheck,
  Inbox,
  type LucideIcon,
  Repeat,
  RotateCw,
  Send,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { GlowingEffect } from "@/components/aceternity/glowing-effect";
import { cn } from "@/lib/utils";

/** A card whose border lights up as the pointer approaches. */
function GlowCard({
  icon: Icon,
  title,
  body,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <li className={cn("relative min-h-[16rem] list-none rounded-2xl border p-1.5", className)}>
      <GlowingEffect
        spread={40}
        glow
        disabled={false}
        proximity={64}
        inactiveZone={0.01}
        borderWidth={2}
      />
      <div className="bg-card/80 relative flex h-full flex-col overflow-hidden rounded-xl border p-6 backdrop-blur">
        <div className="bg-primary/10 text-primary w-fit rounded-lg border border-current/20 p-2">
          <Icon className="size-4" aria-hidden />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{body}</p>
        {children && <div className="mt-6 flex-1">{children}</div>}
      </div>
    </li>
  );
}

const METHODS = ["POST", "PUT", "PATCH", "DELETE", "GET", "HEAD", "OPTIONS"];
const INBOX = [
  { method: "POST", path: "/stripe", hint: "payment_intent.succeeded", ok: true },
  { method: "POST", path: "/github", hint: "push", ok: true },
  { method: "PUT", path: "/orders/42", hint: "orders/updated", ok: true },
  { method: "POST", path: "/slack", hint: "event_callback", ok: false },
  { method: "POST", path: "/stripe", hint: "invoice.paid", ok: true },
];

/** Requests arriving one after another, newest on top. */
function LiveInbox() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduceMotion = useReducedMotion();
  const [tick, setTick] = useState(3);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const id = setInterval(() => setTick((t) => t + 1), 1800);
    return () => clearInterval(id);
  }, [inView, reduceMotion]);

  const rows = Array.from({ length: 4 }, (_, i) => {
    const n = tick - i;
    return { n, ...INBOX[((n % INBOX.length) + INBOX.length) % INBOX.length] };
  });

  return (
    <div ref={ref} className="bg-background/60 rounded-lg border font-mono text-xs">
      <div className="text-muted-foreground flex items-center gap-2 border-b px-3 py-2">
        <span className="relative flex size-2">
          <span className="animate-pulse-ring absolute inline-flex size-full rounded-full bg-emerald-400" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Live · {tick + 1} requests
      </div>
      <ul className="divide-y">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li
              key={r.n}
              layout
              initial={{ opacity: 0, y: -12, backgroundColor: "rgba(99, 102, 241, 0.18)" }}
              animate={{ opacity: 1, y: 0, backgroundColor: "rgba(99, 102, 241, 0)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="flex items-center gap-3 px-3 py-2"
            >
              <span className="text-primary w-12 shrink-0">{r.method}</span>
              <span className="truncate">{r.path}</span>
              <span className="text-muted-foreground ml-auto hidden truncate sm:inline">
                {r.hint}
              </span>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  r.ok ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function TunnelSnippet() {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-300">
      <p>
        <span className="text-zinc-500">$ </span>hookline listen k3Jx… --forward :3000 --sync
      </p>
      <p>
        <span className="text-emerald-400">✓</span> sync mode · your response goes back to the
        sender
      </p>
    </div>
  );
}

function SignatureBadges() {
  return (
    <ul className="flex flex-wrap gap-2 font-mono text-[11px]">
      {["stripe", "github", "shopify", "slack"].map((p, i) => (
        <motion.li
          key={p}
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.12 }}
          className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400"
        >
          <CircleCheck className="size-3" aria-hidden /> {p} verified
        </motion.li>
      ))}
    </ul>
  );
}

function RetryTimeline() {
  const attempts = [
    { label: "#1", note: "503", ok: false },
    { label: "#2", note: "timeout", ok: false },
    { label: "#3", note: "200", ok: true },
  ];
  return (
    <ol className="flex items-center gap-2 font-mono text-[11px]">
      {attempts.map((a, i) => (
        <motion.li
          key={a.label}
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.35 }}
          className="flex items-center gap-2"
        >
          <span
            className={cn(
              "rounded-md border px-2 py-1",
              a.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {a.label} {a.note}
          </span>
          {i < attempts.length - 1 && (
            <RotateCw className="text-muted-foreground size-3" aria-hidden />
          )}
        </motion.li>
      ))}
    </ol>
  );
}

export function FeatureGrid() {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-12">
      <GlowCard
        icon={Activity}
        title="A live inbox"
        body="Requests appear within about 100 ms, with masked headers, a JSON tree and keyboard shortcuts. The stream resumes where it left off after a disconnect."
        className="md:col-span-7"
      >
        <LiveInbox />
      </GlowCard>
      <GlowCard
        icon={Terminal}
        title="Tunnel to localhost"
        body="hookline listen pipes every request to your machine. Sync mode returns your server's answer to the sender."
        className="md:col-span-5"
      >
        <TunnelSnippet />
      </GlowCard>
      <GlowCard
        icon={Inbox}
        title="Capture anything"
        body="Every method on any sub-path, with headers, query, body, source and timing."
        className="md:col-span-4"
      >
        <ul className="flex flex-wrap gap-1.5 font-mono text-[11px]">
          {METHODS.map((m) => (
            <li key={m} className="bg-muted rounded px-1.5 py-0.5">
              {m}
            </li>
          ))}
        </ul>
      </GlowCard>
      <GlowCard
        icon={Repeat}
        title="Replay, edited or not"
        body="Send any request again to a destination, the CLI or any URL, after changing the body if you like."
        className="md:col-span-4"
      >
        <div className="bg-background/60 rounded-lg border p-3 font-mono text-[11px] leading-5">
          <p className="text-red-500/80 line-through">"status": "failed"</p>
          <p className="text-emerald-600 dark:text-emerald-400">"status": "succeeded"</p>
        </div>
      </GlowCard>
      <GlowCard
        icon={ShieldCheck}
        title="Signatures, verified"
        body="Stripe, GitHub, Shopify, Slack, Standard Webhooks, Discord and any HMAC-SHA256, checked at capture."
        className="md:col-span-4"
      >
        <SignatureBadges />
      </GlowCard>
      <GlowCard
        icon={Send}
        title="Forward with retries"
        body="Destinations with method, header and JSON-path filters, durable retries with backoff and a full attempt log, never into private networks."
        className="md:col-span-12"
      >
        <RetryTimeline />
      </GlowCard>
    </ul>
  );
}
