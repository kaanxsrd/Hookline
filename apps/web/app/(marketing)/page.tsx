import {
  Activity,
  ArrowRight,
  Inbox,
  KeyRound,
  Repeat,
  Send,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { REPOSITORY_URL } from "@/lib/site";

const features = [
  {
    icon: Inbox,
    title: "Capture",
    body: "A URL that accepts every method on any sub-path and stores headers, query, body, source and timing.",
  },
  {
    icon: Activity,
    title: "Live inbox",
    body: "Requests appear within about 100 ms, and the stream resumes where it left off after a disconnect.",
  },
  {
    icon: Repeat,
    title: "Replay",
    body: "Send any request again as captured, or edit the method, headers and body first.",
  },
  {
    icon: Send,
    title: "Forward",
    body: "Route to destinations with filters, durable retries with backoff and a full attempt log.",
  },
  {
    icon: Terminal,
    title: "Tunnel",
    body: "hookline listen pipes requests to localhost, and sync mode returns your response to the sender.",
  },
  {
    icon: ShieldCheck,
    title: "Verify",
    body: "Built-in signature checks for Stripe, GitHub, Shopify, Slack, Standard Webhooks and Discord.",
  },
];

const steps = [
  {
    title: "Get a URL",
    body: "Create an endpoint in one click, or with hookline endpoints create. Paste it wherever webhooks are configured.",
  },
  {
    title: "Watch it arrive",
    body: "Every request lands in the inbox live, with headers masked, the body pretty-printed and the signature checked.",
  },
  {
    title: "Send it where it matters",
    body: "Tunnel it to localhost, forward it to staging with retries, or replay it after you fix the bug.",
  },
];

const providers = ["Stripe", "GitHub", "Shopify", "Slack", "Standard Webhooks", "Discord"];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Catch every webhook. Replay anything.{" "}
          <span className="text-primary">Pipe it to localhost.</span>
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
          Hookline gives you a URL that captures any HTTP request, shows it live, lets you inspect,
          replay and forward it, and streams it to your machine through a CLI tunnel.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/new">
              Get a webhook URL
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">No account needed. It lasts 24 hours.</p>

        <TerminalDemo />
      </section>

      <section aria-labelledby="features" className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <h2 id="features" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything between the sender and your code
          </h2>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="bg-card rounded-lg border p-5">
                <Icon className="text-primary size-5" aria-hidden />
                <h3 className="mt-3 font-medium">{title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how" className="bg-muted/30 border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <h2 id="how" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {steps.map(({ title, body }, i) => (
              <li key={title}>
                <span className="text-primary font-mono text-sm">0{i + 1}</span>
                <h3 className="mt-2 font-medium">{title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="trust" className="border-t">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-2">
          <div>
            <h2 id="trust" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Built for payloads that carry secrets
            </h2>
            <p className="text-muted-foreground mt-4">
              Webhooks carry tokens, emails and payment data. Hookline masks sensitive headers until
              you reveal them, records every reveal in the audit log, encrypts signing secrets at
              rest and refuses to forward to internal networks.
            </p>
            <Link
              href="/security"
              className="text-primary mt-4 inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              How Hookline protects your data <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="bg-card rounded-lg border p-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="text-primary size-4" aria-hidden />
              Signatures verified at capture
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {providers.map((p) => (
                <li key={p} className="bg-muted rounded-md px-2.5 py-1 text-sm">
                  {p}
                </li>
              ))}
              <li className="bg-muted text-muted-foreground rounded-md px-2.5 py-1 text-sm">
                any HMAC-SHA256
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Free to start, open source forever
            </h2>
            <p className="text-muted-foreground mt-2">
              Use the hosted service, or run the whole stack yourself under the GNU GPL v3.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/pricing">See pricing</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                View the source
              </a>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

/** A static rendering of `hookline listen` at work. */
function TerminalDemo() {
  const rows: [string, string, string, string, string, string, string?][] = [
    ["12:04:31", "POST", "/h/k3Jx9QpL2mWa/stripe", "200", "38 ms", "payment_intent.succeeded"],
    ["12:04:33", "POST", "/h/k3Jx9QpL2mWa/stripe", "200", "21 ms", "checkout.session.completed"],
    ["12:05:02", "POST", "/h/k3Jx9QpL2mWa/github", "500", "112 ms", "push"],
    ["12:05:40", "POST", "/h/k3Jx9QpL2mWa/github", "200", "44 ms", "push", "replay"],
  ];
  return (
    <figure className="mt-12 overflow-hidden rounded-xl border bg-zinc-950 text-zinc-100 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <figcaption className="ml-2 text-xs text-zinc-400">Terminal</figcaption>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
        <code>
          <span className="text-zinc-500">$ </span>
          hookline listen k3Jx9QpL2mWa --forward http://localhost:3000/api/webhooks
          {"\n"}
          <span className="text-emerald-400">✓ </span>
          Forwarding{" "}
          <span className="text-indigo-300">https://hooks.example.com/h/k3Jx9QpL2mWa</span> →
          http://localhost:3000/api/webhooks
          {rows.map(([time, method, path, status, ms, hint, marker]) => (
            <span key={`${time}${hint}`}>
              {"\n"}
              {time} {method} {path}
              {marker && <span className="text-indigo-300"> ({marker})</span>}
              {"  → "}
              <span className={status === "200" ? "text-emerald-400" : "text-red-400"}>
                {status}
              </span>
              <span className="text-zinc-500">
                {"  "}
                {ms}
                {"  "}
                {hint}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
