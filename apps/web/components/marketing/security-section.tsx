"use client";

import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { EncryptedText } from "@/components/aceternity/encrypted-text";

const HEADERS: [string, string, boolean][] = [
  ["Content-Type", "application/json", false],
  ["Stripe-Signature", "t=1793353786,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e7", true],
  ["Authorization", "Bearer tok_7f3a9c2e41d84b6f", true],
  ["User-Agent", "Stripe/1.0 (+https://stripe.com/docs/webhooks)", false],
];

export function SecuritySection() {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <div>
        <p className="text-primary font-mono text-xs tracking-[0.2em] uppercase">Security</p>
        <h2
          id="trust"
          className="mt-3 font-mono text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
        >
          <EncryptedText
            text="Built for payloads that carry secrets"
            encryptedClassName="text-muted-foreground"
            revealDelayMs={35}
          />
        </h2>
        <p className="text-muted-foreground mt-4 text-pretty">
          Webhooks carry tokens, emails and payment data. Hookline masks sensitive headers until you
          reveal them, records every reveal in the audit log, encrypts signing secrets at rest and
          refuses to forward to internal networks.
        </p>
        <Link
          href="/security"
          className="text-primary mt-6 inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          How Hookline protects your data <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="bg-card/80 relative overflow-hidden rounded-2xl border p-5 shadow-[0_0_60px_-30px_var(--primary)] backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Lock className="text-primary size-4" aria-hidden /> Headers
          </p>
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors"
          >
            {revealed ? (
              <EyeOff className="size-3.5" aria-hidden />
            ) : (
              <Eye className="size-3.5" aria-hidden />
            )}
            {revealed ? "Mask" : "Reveal"}
          </button>
        </div>
        <dl className="mt-4 divide-y font-mono text-xs">
          {HEADERS.map(([name, value, secret]) => (
            <div key={name} className="grid grid-cols-[9rem_1fr] gap-3 py-2">
              <dt className="text-muted-foreground truncate">{name}</dt>
              <dd className="truncate">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={secret && !revealed ? "masked" : "shown"}
                    initial={{ opacity: 0, filter: "blur(4px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(4px)" }}
                    transition={{ duration: 0.2 }}
                    className="block truncate"
                  >
                    {secret && !revealed ? "••••••••" : value}
                  </motion.span>
                </AnimatePresence>
              </dd>
            </div>
          ))}
        </dl>
        <AnimatePresence>
          {revealed && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-700 dark:text-amber-300"
            >
              audit · request.headers_revealed · you · just now
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
