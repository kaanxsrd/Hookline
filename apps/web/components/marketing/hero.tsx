"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { BackgroundBeams } from "@/components/aceternity/background-beams";
import { FlipWords } from "@/components/aceternity/flip-words";
import { MovingBorderLink } from "@/components/aceternity/moving-border";
import { Spotlight } from "@/components/aceternity/spotlight-new";
import { TextGenerateEffect } from "@/components/aceternity/text-generate-effect";
import { AnimatedTerminal } from "./animated-terminal";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as const },
});

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="bg-grid mask-radial absolute inset-0 -z-20 opacity-70" />
      <div
        aria-hidden
        className="from-primary/25 absolute top-[-20%] left-1/2 -z-10 h-[38rem] w-[60rem] -translate-x-1/2 rounded-full bg-radial to-transparent to-70% blur-3xl"
      />
      <BackgroundBeams className="-z-10 opacity-60" />
      <Spotlight />

      <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-24">
        <motion.div {...rise(0)}>
          <Link
            href="/changelog"
            className="bg-background/60 hover:border-primary/50 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur transition-colors"
          >
            <Sparkles className="text-primary size-3.5" aria-hidden />
            <span className="text-muted-foreground">
              Hookline 0.1 · free software under GPL-3.0
            </span>
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </motion.div>

        {/* Visible from the first paint (it is the largest text): it only slides in. */}
        <motion.h1
          initial={{ y: 12 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-8 max-w-4xl text-4xl font-semibold tracking-tighter text-balance sm:text-6xl lg:text-7xl"
        >
          <span className="text-gradient">Catch every webhook. Replay anything. </span>
          <span className="text-gradient-brand">Pipe it to localhost.</span>
        </motion.h1>

        <motion.p {...rise(0.16)} className="text-muted-foreground mx-auto mt-6 text-lg sm:text-xl">
          Debug
          <FlipWords
            words={["Stripe", "GitHub", "Shopify", "Slack", "Discord", "any"]}
            className="text-foreground font-mono font-medium"
          />
          webhooks in real time.
        </motion.p>

        <TextGenerateEffect
          className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base text-pretty"
          words="A URL that captures any HTTP request, shows it live, lets you inspect, replay and forward it, and streams it to your machine through a CLI tunnel."
        />

        <motion.div
          {...rise(0.3)}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <MovingBorderLink href="/new">
            Get a webhook URL <ArrowRight className="size-4" aria-hidden />
          </MovingBorderLink>
          <Link
            href="/docs"
            className="bg-background/60 hover:bg-accent inline-flex h-11 items-center rounded-lg border px-5 text-sm font-medium backdrop-blur transition-colors"
          >
            Read the docs
          </Link>
        </motion.div>
        <motion.p {...rise(0.4)} className="text-muted-foreground mt-3 font-mono text-xs">
          No account needed · lasts 24 hours
        </motion.p>

        <AnimatedTerminal className="mx-auto mt-16 max-w-3xl" />
      </div>
    </section>
  );
}
