import { limitsFor, type Plan, plans } from "@hookline/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { UserStateBadges } from "@/components/admin/admin-bits";
import { formatDate, formatNumber } from "@/components/admin/format";
import { PageBody, PageHeader } from "@/components/page-header";
import { api, load } from "@/lib/trpc/server";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const data = await load(async () => (await api()).admin.overview());
  const t = data.totals;
  const stats = [
    { label: "Users", value: t.users, note: `${formatNumber(t.usersThisWeek)} new this week` },
    { label: "Organizations", value: t.orgs, note: `${formatNumber(t.admins)} administrators` },
    {
      label: "Endpoints",
      value: t.endpoints,
      note: `${formatNumber(t.anonymousEndpoints)} temporary endpoints live`,
    },
    {
      label: "Requests this month",
      value: t.requestsThisMonth,
      note: "Rolled up hourly",
    },
  ];

  return (
    <PageBody>
      <PageHeader title="Overview" description="The whole instance at a glance." />

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(s.value)}</dd>
            <dd className="text-muted-foreground mt-1 text-xs">{s.note}</dd>
          </div>
        ))}
      </dl>

      {(t.usersDisabled > 0 || t.disabledEndpoints > 0) && (
        <p className="text-muted-foreground mt-4 text-sm">
          {formatNumber(t.usersDisabled)} disabled {t.usersDisabled === 1 ? "user" : "users"} ·{" "}
          <Link
            href="/admin/endpoints?status=disabled"
            className="underline-offset-4 hover:underline"
          >
            {formatNumber(t.disabledEndpoints)} disabled{" "}
            {t.disabledEndpoints === 1 ? "endpoint" : "endpoints"}
          </Link>
        </p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <section className="bg-card rounded-lg border lg:col-span-2" aria-labelledby="recent">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="recent" className="font-medium">
              Recent sign-ups
            </h2>
            <Link
              href="/admin/users"
              className="text-primary text-sm underline-offset-4 hover:underline"
            >
              All users
            </Link>
          </div>
          <ul className="divide-y">
            {data.recentUsers.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="hover:bg-accent/50 flex items-center justify-between gap-4 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">{u.email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <UserStateBadges isAdmin={false} disabledAt={u.disabledAt} />
                    <span className="text-muted-foreground text-xs">{formatDate(u.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
            {data.recentUsers.length === 0 && (
              <li className="text-muted-foreground px-4 py-6 text-center text-sm">No users yet.</li>
            )}
          </ul>
        </section>

        <div className="grid content-start gap-6">
          <section className="bg-card rounded-lg border p-4" aria-labelledby="plans">
            <h2 id="plans" className="font-medium">
              Organizations by plan
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(["free", "pro", "team"] as const).map((p) => (
                <li key={p} className="flex justify-between">
                  <span>{limitsFor(p).name}</span>
                  <span className="tabular-nums">{formatNumber(data.plans[p] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="bg-card rounded-lg border p-4" aria-labelledby="instance">
            <h2 id="instance" className="font-medium">
              Instance
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt>Billing</dt>
                <dd className="text-muted-foreground">
                  {data.instance.billingEnabled ? "Stripe" : "Off"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Plan override</dt>
                <dd className="text-muted-foreground">
                  {data.instance.planOverride
                    ? plans[data.instance.planOverride as Plan].name
                    : "None"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </PageBody>
  );
}
