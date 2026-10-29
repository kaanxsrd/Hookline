import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { UserStateBadges } from "@/components/admin/admin-bits";
import { formatDate, formatDateTime } from "@/components/admin/format";
import { PageBody, PageHeader } from "@/components/page-header";
import { api, load } from "@/lib/trpc/server";
import { UserActions } from "./user-actions";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await load(async () => (await api()).admin.users.get({ id }));

  const facts: [string, string][] = [
    ["Email", `${user.email}${user.emailVerified ? "" : " (unverified)"}`],
    ["Joined", formatDate(user.createdAt)],
    ["Last active", formatDateTime(user.lastActiveAt)],
    ["Active sessions", String(user.activeSessions)],
    ["Two-factor", user.twoFactorEnabled ? "On" : "Off"],
    ["Passkeys", String(user.passkeys)],
  ];
  if (user.disabledAt) facts.push(["Disabled", formatDateTime(user.disabledAt)]);

  return (
    <PageBody>
      <Link href="/admin/users" className="text-muted-foreground text-sm hover:underline">
        ← Users
      </Link>
      <div className="mt-4">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              {user.name}
              <UserStateBadges isAdmin={user.isAdmin} disabledAt={user.disabledAt} />
            </span>
          }
          description={user.email}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <section className="bg-card rounded-lg border" aria-labelledby="orgs">
            <h2 id="orgs" className="border-b px-4 py-3 font-medium">
              Organizations
            </h2>
            <ul className="divide-y">
              {user.memberships.map((m) => (
                <li key={m.orgId}>
                  <Link
                    href={`/admin/organizations/${m.orgId}`}
                    className="hover:bg-accent/50 flex items-center justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {m.name} <span className="text-muted-foreground">/{m.slug}</span>
                    </span>
                    <span className="text-muted-foreground capitalize">{m.role}</span>
                  </Link>
                </li>
              ))}
              {user.memberships.length === 0 && (
                <li className="text-muted-foreground px-4 py-6 text-center text-sm">
                  Not a member of any organization.
                </li>
              )}
            </ul>
          </section>

          <section className="bg-card rounded-lg border" aria-labelledby="keys">
            <h2 id="keys" className="border-b px-4 py-3 font-medium">
              Active API keys created by this user
            </h2>
            <ul className="divide-y">
              {user.apiKeys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {k.name} <span className="text-muted-foreground font-mono">{k.prefix}…</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    /{k.orgSlug} · last used {formatDateTime(k.lastUsedAt)}
                  </span>
                </li>
              ))}
              {user.apiKeys.length === 0 && (
                <li className="text-muted-foreground px-4 py-6 text-center text-sm">None.</li>
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
          <UserActions
            user={{
              id: user.id,
              name: user.name,
              isAdmin: user.isAdmin,
              disabled: Boolean(user.disabledAt),
              isYou: user.isYou,
              apiKeys: user.apiKeys.length,
            }}
          />
        </div>
      </div>
    </PageBody>
  );
}
