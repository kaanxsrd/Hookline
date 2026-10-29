import { limitsFor } from "@hookline/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { UserStateBadges } from "@/components/admin/admin-bits";
import { formatDate, formatDateTime, formatNumber } from "@/components/admin/format";
import { PageBody, PageHeader } from "@/components/page-header";
import { EndpointStatusBadge } from "@/components/status-badge";
import { api, load } from "@/lib/trpc/server";
import { PlanForm } from "./plan-form";

export const metadata: Metadata = { title: "Organization" };

export default async function AdminOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const org = await load(async () => (await api()).admin.orgs.get({ id }));
  const limits = limitsFor(org.effectivePlan);
  const meter = (used: number, limit: number | null) =>
    `${formatNumber(used)} / ${limit === null ? "unlimited" : formatNumber(limit)}`;

  const facts: [string, string][] = [
    ["URL", `/${org.slug}`],
    ["Created", formatDate(org.createdAt)],
    ["Plan in force", limits.name],
    ["Subscription", org.subscriptionStatus ?? "none"],
    ["Requests this month", meter(org.usage.requests.used, org.usage.requests.limit)],
    ["Endpoints", meter(org.usage.endpoints.used, org.usage.endpoints.limit)],
    ["Members", meter(org.members.length, limits.members)],
  ];
  if (org.currentPeriodEnd) facts.push(["Renews", formatDate(org.currentPeriodEnd)]);

  return (
    <PageBody>
      <Link href="/admin/organizations" className="text-muted-foreground text-sm hover:underline">
        ← Organizations
      </Link>
      <div className="mt-4">
        <PageHeader title={org.name} description={`/${org.slug}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <section className="bg-card rounded-lg border" aria-labelledby="members">
            <h2 id="members" className="border-b px-4 py-3 font-medium">
              Members
            </h2>
            <ul className="divide-y">
              {org.members.map((m) => (
                <li key={m.userId}>
                  <Link
                    href={`/admin/users/${m.userId}`}
                    className="hover:bg-accent/50 flex items-center justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate">{m.name}</span>
                        <UserStateBadges isAdmin={false} disabledAt={m.disabledAt} />
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {m.email}
                      </span>
                    </span>
                    <span className="text-muted-foreground capitalize">{m.role}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-card rounded-lg border" aria-labelledby="endpoints">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 id="endpoints" className="font-medium">
                Endpoints
              </h2>
              <Link
                href="/admin/endpoints"
                className="text-primary text-sm underline-offset-4 hover:underline"
              >
                Manage endpoints
              </Link>
            </div>
            <ul className="divide-y">
              {org.endpoints.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{e.name}</span>
                    <span className="text-muted-foreground block font-mono text-xs">{e.slug}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-muted-foreground hidden text-xs sm:inline">
                      {formatNumber(e.requestCount)} requests · last{" "}
                      {formatDateTime(e.lastRequestAt)}
                    </span>
                    <EndpointStatusBadge status={e.status} />
                  </span>
                </li>
              ))}
              {org.endpoints.length === 0 && (
                <li className="text-muted-foreground px-4 py-6 text-center text-sm">
                  No endpoints.
                </li>
              )}
            </ul>
          </section>
        </div>

        <div className="grid content-start gap-6">
          <section className="bg-card rounded-lg border p-4" aria-labelledby="details">
            <h2 id="details" className="font-medium">
              Details
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt>{k}</dt>
                  <dd className="text-muted-foreground truncate text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <PlanForm
            orgId={org.id}
            orgName={org.name}
            planOverride={org.planOverride ?? null}
            subscribedPlan={org.plan ?? "free"}
            billingEnabled={org.billingEnabled}
            instanceOverride={org.instanceOverride}
          />
        </div>
      </div>
    </PageBody>
  );
}
