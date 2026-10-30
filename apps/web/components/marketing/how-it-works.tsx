"use client";

import { motion } from "motion/react";

const STEPS = [
  {
    title: "Get a URL",
    body: "One click, no account. Paste it wherever webhooks are configured.",
    code: "https://hooks.vante.app/h/k3Jx9QpL2mWa",
  },
  {
    title: "Watch it arrive",
    body: "Every request lands live: headers masked, body pretty-printed, signature checked.",
    code: "POST /stripe  ✓ verified  38 ms",
  },
  {
    title: "Send it where it matters",
    body: "Tunnel it to localhost, forward it with retries, or replay it after the fix.",
    code: "hookline replay 0192… --to :3000",
  },
];

/** Three steps joined by a beam that draws itself as the section scrolls in. */
export function HowItWorks() {
  return (
    <div className="relative">
      <svg
        aria-hidden
        className="absolute top-6 left-0 hidden h-2 w-full md:block"
        preserveAspectRatio="none"
        viewBox="0 0 100 2"
      >
        <defs>
          <linearGradient id="how-beam" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
            <stop offset="30%" stopColor="var(--primary)" />
            <stop offset="70%" stopColor="var(--color-brand-cyan)" />
            <stop offset="100%" stopColor="var(--color-brand-cyan)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M 0 1 L 100 1"
          stroke="url(#how-beam)"
          strokeWidth="0.6"
          fill="none"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-120px" }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
        />
      </svg>
      <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
        {STEPS.map((step, i) => (
          <motion.li
            key={step.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.25 * i, duration: 0.6 }}
          >
            <span className="from-primary to-brand-cyan text-primary-foreground relative z-10 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br font-mono text-sm font-semibold shadow-[0_0_30px_-6px_var(--primary)]">
              0{i + 1}
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-tight">{step.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{step.body}</p>
            <code className="bg-muted/60 mt-4 block truncate rounded-md border px-3 py-2 font-mono text-xs">
              {step.code}
            </code>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
