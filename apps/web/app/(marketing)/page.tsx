import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LampContainer } from "@/components/aceternity/lamp";
import { MovingBorderLink } from "@/components/aceternity/moving-border";
import { GithubIcon } from "@/components/icons/github";
import { EventMarquee } from "@/components/marketing/event-marquee";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SectionHeading } from "@/components/marketing/section-heading";
import { SecuritySection } from "@/components/marketing/security-section";
import { REPOSITORY_URL } from "@/lib/site";

export default function HomePage() {
  return (
    <>
      <Hero />

      <section aria-label="Webhooks Hookline understands" className="border-y py-6">
        <EventMarquee />
      </section>

      <section aria-labelledby="features" className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
        <SectionHeading
          id="features"
          eyebrow="Features"
          title="Everything between the sender and your code"
        >
          Capture, inspect, verify, replay and forward, from the dashboard, the CLI or the API.
        </SectionHeading>
        <div className="mt-12">
          <FeatureGrid />
        </div>
      </section>

      <section aria-labelledby="how" className="relative border-y">
        <div aria-hidden className="bg-dots mask-radial absolute inset-0 -z-10 opacity-60" />
        <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
          <SectionHeading
            id="how"
            eyebrow="How it works"
            title="From URL to localhost in a minute"
          />
          <div className="mt-14">
            <HowItWorks />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
        <SecuritySection />
      </section>

      <LampContainer>
        <h2 className="max-w-2xl bg-gradient-to-br from-zinc-100 to-zinc-400 bg-clip-text text-center text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
          Your next webhook is one URL away
        </h2>
        <p className="mt-4 max-w-xl text-center text-zinc-400">
          Free to start, with no credit card. Or run the whole stack yourself: Hookline is free
          software under the GNU GPL v3.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <MovingBorderLink href="/new">
            Get a webhook URL <ArrowRight className="size-4" aria-hidden />
          </MovingBorderLink>
          <Link
            href="/pricing"
            className="inline-flex h-11 items-center rounded-lg border border-white/15 px-5 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10"
          >
            See pricing
          </Link>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/15 px-5 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10"
          >
            <GithubIcon className="size-4" /> Source
          </a>
        </div>
      </LampContainer>
    </>
  );
}
