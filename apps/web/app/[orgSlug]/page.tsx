import { schema } from "@hookline/db";
import { and, count, eq, gte } from "drizzle-orm";
import { Plus, Webhook } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RelativeTime } from "@/components/inbox/relative-time";
import { PageBody, PageHeader } from "@/components/page-header";
import { EndpointStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { api, load } from "@/lib/trpc/server";

export const metadata: Metadata = {
  title: "Overview",
  description: "Your organization at a glance.",
};

export default async function OverviewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const caller = await api();
  const [org, endpoints] = await Promise.all([
    load(() => caller.org.current({ orgSlug })),
    load(() => caller.endpoint.list({ orgSlug })),
  ]);

  const since = new Date(Date.now() - 24 * 3_600_000);
  const [last24h] = await getDb()
    .select({ n: count() })
    .from(schema.request)
    .where(and(eq(schema.request.orgId, org.id), gte(schema.request.receivedAt, since)));

  const stats = [
    { label: "Requests in the last 24 hours", value: (last24h?.n ?? 0).toLocaleString("en") },
    {
      label: "Endpoints",
      value: `${endpoints.length}${org.limits.endpoints === null ? "" : ` / ${org.limits.endpoints}`}`,
    },
    { label: "Plan", value: org.limits.name },
  ];

  return (
    <PageBody>
      <PageHeader
        title={org.name}
        description="Your organization at a glance."
        actions={
          <Button asChild>
            <Link href={`/${orgSlug}/endpoints/new`}>
              <Plus aria-hidden /> New endpoint
            </Link>
          </Button>
        }
      />
      <dl className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="mb-3 font-medium">Endpoints</h2>
        {endpoints.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-12 text-center">
            <Webhook className="text-muted-foreground mx-auto mb-3 size-8" aria-hidden />
            <p className="font-medium">No endpoints yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Create one to get a URL that captures every request.
            </p>
            <Button asChild className="mt-4">
              <Link href={`/${orgSlug}/endpoints/new`}>Create endpoint</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {endpoints.slice(0, 8).map((e) => (
              <li key={e.id}>
                <Link
                  href={`/${orgSlug}/endpoints/${e.slug}`}
                  className="hover:bg-accent/50 flex items-center gap-4 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="text-muted-foreground block truncate font-mono text-xs">
                      {e.url}
                    </span>
                  </span>
                  <EndpointStatusBadge status={e.status} />
                  <span className="text-muted-foreground hidden w-28 text-right text-xs sm:block">
                    {e.lastRequestAt ? (
                      <RelativeTime iso={e.lastRequestAt.toISOString()} />
                    ) : (
                      "No requests"
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageBody>
  );
}
