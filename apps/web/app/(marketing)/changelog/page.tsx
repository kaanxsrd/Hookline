import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Timeline } from "@/components/aceternity/timeline";
import { PageHero } from "@/components/marketing/page-hero";
import { REPOSITORY_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What is new in Hookline.",
};

const code = (s: string) => (
  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em]">{s}</code>
);

/** The 1.0.0 release, area by area. Newest releases go first. */
const AREAS: { id: string; title: string; items: ReactNode[] }[] = [
  {
    id: "capture",
    title: "Capture",
    items: [
      "Webhook URLs that accept every method on any sub-path, with configurable status, headers, body and delay.",
      "Temporary endpoints without an account, which you can keep by signing up.",
      "A live inbox that updates in about 100 ms and resumes after a disconnect, with filters, full-text search, keyboard shortcuts and JSON tree, form, XML, raw and hex views.",
      "Sensitive headers masked until revealed, with each reveal audited.",
      "Copy any request as cURL, fetch or HTTPie.",
    ],
  },
  {
    id: "forward",
    title: "Replay",
    items: [
      "Replay to a destination, to the CLI or to any URL, as captured or edited.",
      "Signature verification for Stripe, GitHub, Shopify, Slack, Standard Webhooks, Discord and generic HMAC-SHA256.",
      "Destinations with method, header and JSON-path filters, durable retries with backoff and an attempt log, optionally signed with Standard Webhooks.",
    ],
  },
  {
    id: "cli",
    title: "CLI",
    items: [
      <>
        {code("hookline login")} with the device flow, plus {code("listen")}, {code("tail")},{" "}
        {code("replay")}, {code("trigger")}, {code("endpoints")} and {code("update")}.
      </>,
      "Tunnels that forward to localhost, with path rewrites, extra headers, method filters and sync responses.",
    ],
  },
  {
    id: "teams",
    title: "Teams",
    items: [
      "Organizations with viewer, member, admin and owner roles, invitations and an audit log.",
      "Passkeys and TOTP two-factor authentication.",
      "A REST API described by OpenAPI, with scoped keys, idempotency keys and rate limits.",
    ],
  },
  {
    id: "plans",
    title: "Plans",
    items: [
      "Free, Pro and Team plans with a usage page, email alerts at 80 % and 100 %, and Stripe billing.",
      "Marketing site, documentation, a status page and an administration area for instance operators.",
    ],
  },
  {
    id: "design",
    title: "Design",
    items: [
      "An animated marketing site and documentation with live terminal, event and timeline sections.",
      "A dashboard with a getting-started checklist, metric cards and charts, status pills, breadcrumbs and a usage meter in the sidebar.",
      "Animations respect the reduced-motion setting of your system.",
    ],
  },
  {
    id: "release",
    title: "Self-hosting",
    items: [
      "Production images for the web app, edge, worker and migrations, a Docker Compose setup with Caddy, TLS and daily backups, and Fly.io and Railway configurations.",
      <>
        Email through Resend over HTTPS ({code("RESEND_API_KEY")}) or any SMTP server, for hosts
        that block outgoing SMTP.
      </>,
      "Deploys to Railway after CI passes on main, migrations first, then a smoke test.",
      "The CLI on Homebrew, Scoop and npm, with archives for macOS, Linux and Windows.",
      "A load-testing script and vulnerability scanning in CI.",
      "Licensed under the GNU General Public License v3.0.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <PageHero eyebrow="Changelog" title="Changelog">
        New features, improvements and fixes, newest first. Each version is a{" "}
        <a
          href={`${REPOSITORY_URL}/releases`}
          className="text-primary underline-offset-4 hover:underline"
        >
          release on GitHub
        </a>{" "}
        with the CLI and the server images.
      </PageHero>
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <section className="mb-16 grid gap-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-mono text-2xl font-semibold">1.0.1</h2>
            <a
              href={`${REPOSITORY_URL}/releases/tag/v1.0.1`}
              className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors"
            >
              latest
            </a>
            <time dateTime="2026-11-02" className="text-muted-foreground font-mono text-xs">
              2026-11-02
            </time>
          </div>
          <ul className="bg-card/60 max-w-3xl space-y-3 rounded-xl border p-6 text-sm leading-relaxed backdrop-blur">
            <li className="flex gap-3">
              <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
              <span>
                {code("npm install -g hookline-cli")} now works on Windows x64: the platform
                binaries moved to {code("@vantedev/hookline-cli-<os>-<cpu>")}.
              </span>
            </li>
          </ul>
        </section>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-mono text-2xl font-semibold">1.0.0</h2>
          <time dateTime="2026-10-30" className="text-muted-foreground font-mono text-xs">
            2026-10-30
          </time>
          <p className="text-muted-foreground text-sm">The first stable release of Hookline.</p>
        </div>
        <Timeline
          data={AREAS.map((area) => ({
            id: area.id,
            title: area.title,
            content: (
              <ul className="bg-card/60 space-y-3 rounded-xl border p-6 text-sm leading-relaxed backdrop-blur">
                {area.items.map((item, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list in document order
                  <li key={i} className="flex gap-3">
                    <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ),
          }))}
        />
      </div>
    </>
  );
}
