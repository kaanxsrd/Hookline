import { Activity, ArrowRight, Inbox, Repeat, Send, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    icon: Inbox,
    title: "Capture",
    body: "A URL that accepts every method on any sub-path and stores headers, query, body, source and timing.",
  },
  {
    icon: Activity,
    title: "Live inbox",
    body: "Requests appear within about 100 ms and the stream resumes after a disconnect.",
  },
  {
    icon: Repeat,
    title: "Replay",
    body: "Re-send any request as captured, or edit the method, headers and body first.",
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

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <span className="font-semibold tracking-tight">Hookline</span>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Catch every webhook. Replay anything.{" "}
          <span className="text-primary">Pipe it to localhost.</span>
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-lg text-pretty">
          Hookline gives you a URL that captures any HTTP request, shows it live, lets you inspect,
          replay and forward it, and streams it to your machine through a CLI tunnel.
        </p>
        <Link
          href="/new"
          className="bg-primary text-primary-foreground mt-8 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          Get a webhook URL
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        <p className="text-muted-foreground mt-2 text-xs">No account needed. It lasts 24 hours.</p>

        <pre className="bg-card text-card-foreground mt-10 overflow-x-auto rounded-lg border p-4 font-mono text-sm">
          <code>
            <span className="text-muted-foreground">$ </span>
            hookline listen my-endpoint --forward http://localhost:3000/api/webhooks
          </code>
        </pre>

        <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <li key={title} className="bg-card rounded-lg border p-5">
              <Icon className="text-primary size-5" aria-hidden />
              <h2 className="mt-3 font-medium">{title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-5xl px-4 py-6 text-sm sm:px-6">
          Hookline is open source under the MIT license.
        </div>
      </footer>
    </div>
  );
}
