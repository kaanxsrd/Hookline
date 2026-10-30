import { schema } from "@hookline/db";
import { and, count, eq, isNull } from "drizzle-orm";
import { ArrowUpRight, Check, Plus, Webhook } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AreaChart } from "@/components/area-chart";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/inbox/relative-time";
import { PageBody, PageHeader } from "@/components/page-header";
import { Sparkline } from "@/components/sparkline";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { api, load } from "@/lib/trpc/server";
import { monthUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Overview",
  description: "Your organization at a glance.",
};

const n = (v: number) => v.toLocaleString("en-US");

function Metric({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="bg-card/50 flex flex-col rounded-xl border p-5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="text-muted-foreground mt-1 text-xs">{hint}</dd>}
      {children && <dd className="mt-auto pt-3">{children}</dd>}
    </div>
  );
}

export default async function OverviewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const caller = await api();
  const [org, endpoints, session] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.list({ orgSlug })),
    getSession(),
  ]);

  const db = getDb();
  const [usage, [keys], [destinations]] = await Promise.all([
    monthUsage(db, org.id),
    db
      .select({ n: count() })
      .from(schema.apiKey)
      .where(and(eq(schema.apiKey.orgId, org.id), isNull(schema.apiKey.revokedAt))),
    db
      .select({ n: count() })
      .from(schema.destination)
      .innerJoin(schema.endpoint, eq(schema.endpoint.id, schema.destination.endpointId))
      .where(eq(schema.endpoint.orgId, org.id)),
  ]);

  // Requests per hour over the last 24 hours, across every endpoint.
  const hourly = Array.from({ length: 24 }, (_, h) =>
    endpoints.reduce((sum, e) => sum + (e.last24h[h] ?? 0), 0),
  );
  const last24h = hourly.reduce((a, b) => a + b, 0);
  const monthPct =
    usage.requests.limit === null
      ? null
      : Math.min(100, (usage.requests.used / usage.requests.limit) * 100);

  const base = `/${orgSlug}`;
  const steps = [
    { done: endpoints.length > 0, title: "Create an endpoint", href: `${base}/endpoints/new` },
    {
      done: endpoints.some((e) => e.requestCount > 0),
      title: "Capture your first request",
      href: endpoints[0] ? `${base}/endpoints/${endpoints[0].slug}` : `${base}/endpoints/new`,
    },
    { done: (keys?.n ?? 0) > 0, title: "Sign in with the CLI", href: "/docs/cli" },
    {
      done: (destinations?.n ?? 0) > 0,
      title: "Forward to a destination",
      href: "/docs/destinations",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const firstName = session?.user.name.split(/\s+/)[0];

  return (
    <PageBody wide>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Overview"}
        description={`${org.name} · ${org.limits.name} plan`}
        actions={
          hasRole(org.role, "member") && (
            <Button asChild>
              <Link href={`${base}/endpoints/new` as Route}>
                <Plus aria-hidden /> New endpoint
              </Link>
            </Button>
          )
        }
      />

      {doneCount < steps.length && (
        <section
          aria-labelledby="getting-started"
          className="bg-card/50 relative mb-8 overflow-hidden rounded-xl border p-5"
        >
          <div
            aria-hidden
            className="from-primary/10 absolute inset-0 -z-10 bg-gradient-to-br via-transparent to-transparent"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="getting-started" className="font-medium">
                Get started with Hookline
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {doneCount} of {steps.length} done
              </p>
            </div>
            <div className="bg-muted h-1.5 w-40 overflow-hidden rounded-full">
              <div
                className="from-primary to-brand-cyan h-full rounded-full bg-gradient-to-r"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Link
                  href={s.href as Route}
                  className={cn(
                    "group bg-background/60 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                    s.done ? "text-muted-foreground" : "hover:border-primary/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]",
                      s.done && "border-emerald-500/40 bg-emerald-500/15 text-emerald-500",
                    )}
                  >
                    {s.done ? <Check className="size-3" aria-hidden /> : i + 1}
                  </span>
                  <span className={cn("flex-1", s.done && "line-through")}>{s.title}</span>
                  {!s.done && (
                    <ArrowUpRight
                      className="text-muted-foreground group-hover:text-foreground size-3.5"
                      aria-hidden
                    />
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Requests · last 24 hours" value={n(last24h)}>
          <AreaChart
            values={hourly}
            label={`${n(last24h)} requests in the last 24 hours, by hour`}
          />
        </Metric>
        <Metric
          label="Requests this month"
          value={n(usage.requests.used)}
          hint={usage.requests.limit === null ? "Unlimited" : `of ${n(usage.requests.limit)}`}
        >
          {monthPct !== null && (
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full",
                  monthPct >= 100 ? "bg-red-500" : monthPct >= 80 ? "bg-amber-500" : "bg-primary",
                )}
                style={{ width: `${monthPct}%` }}
              />
            </div>
          )}
        </Metric>
        <Metric
          label="Endpoints"
          value={n(endpoints.length)}
          hint={org.limits.endpoints === null ? "Unlimited" : `of ${n(org.limits.endpoints)}`}
        />
        <Metric
          label="Plan"
          value={org.limits.name}
          hint={
            <Link
              href={`${base}/settings/billing` as Route}
              className="text-primary inline-flex items-center gap-0.5 hover:underline"
            >
              Manage plan <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          }
        />
      </dl>

      <section aria-labelledby="endpoints" className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="endpoints" className="font-medium">
            Endpoints
          </h2>
          {endpoints.length > 0 && (
            <Link
              href={`${base}/endpoints` as Route}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              View all
            </Link>
          )}
        </div>
        {endpoints.length === 0 ? (
          <EmptyState
            icon={Webhook}
            title="No endpoints yet"
            action={
              <Button asChild>
                <Link href={`${base}/endpoints/new` as Route}>Create endpoint</Link>
              </Button>
            }
          >
            Create one to get a URL that captures every request.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Last 24 hours</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Last request</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.slice(0, 8).map((e) => (
                  <TableRow key={e.id} className="relative">
                    <TableCell className="w-full max-w-0">
                      <Link
                        href={`${base}/endpoints/${e.slug}` as Route}
                        className="block after:absolute after:inset-0"
                      >
                        <span className="block truncate font-medium">{e.name}</span>
                        <span className="text-muted-foreground block truncate font-mono text-xs">
                          {e.url}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <EndpointStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Sparkline values={e.last24h} label={e.name} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-right text-xs sm:table-cell">
                      {e.lastRequestAt ? (
                        <RelativeTime iso={e.lastRequestAt.toISOString()} />
                      ) : (
                        "No requests"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </PageBody>
  );
}
