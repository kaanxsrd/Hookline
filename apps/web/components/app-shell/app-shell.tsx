"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChartColumn,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Search,
  Send,
  Settings,
  Webhook,
} from "lucide-react";
import { motion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

export type ShellOrg = { slug: string; name: string; role: string; plan: string };
export type ShellUser = { name: string; email: string; image: string | null; isAdmin: boolean };

type Props = {
  org: ShellOrg;
  orgs: { slug: string; name: string }[];
  user: ShellUser;
  appHost: string;
  children: ReactNode;
};

export function AppShell({ org, orgs, user, appHost, children }: Props) {
  const palette = useCommandPalette();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <SidebarContent
      org={org}
      orgs={orgs}
      user={user}
      appHost={appHost}
      onSearch={() => {
        setMobileOpen(false);
        palette.setOpen(true);
      }}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="bg-background sticky top-0 hidden h-dvh w-60 shrink-0 border-r md:flex">
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex h-12 items-center gap-2 border-b px-3 backdrop-blur md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
          <Breadcrumbs org={org} />
          <Link
            href="/docs"
            className="text-muted-foreground hover:text-foreground ml-auto hidden items-center gap-1.5 text-xs transition-colors sm:flex"
          >
            <BookOpen className="size-3.5" aria-hidden /> Docs
          </Link>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <CommandPalette org={org} open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}

const SEGMENT_LABELS: Record<string, string> = {
  endpoints: "Endpoints",
  deliveries: "Deliveries",
  usage: "Usage",
  settings: "Settings",
  general: "General",
  members: "Members",
  "api-keys": "API keys",
  billing: "Billing",
  "audit-log": "Audit log",
  destinations: "Destinations",
  requests: "Requests",
  new: "New",
};

/** Organization › section › item, from the URL. */
function Breadcrumbs({ org }: { org: ShellOrg }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean).slice(1);
  const crumbs = segments.map((seg, i) => ({
    href: `/${org.slug}/${segments.slice(0, i + 1).join("/")}`,
    label: SEGMENT_LABELS[seg] ?? seg,
    mono: !(seg in SEGMENT_LABELS),
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        href={`/${org.slug}` as Route}
        className="text-muted-foreground hover:text-foreground truncate transition-colors"
      >
        {org.name}
      </Link>
      {crumbs.map((c, i) => (
        <Fragment key={c.href}>
          <ChevronRight className="text-muted-foreground/60 size-3.5 shrink-0" aria-hidden />
          {i === crumbs.length - 1 ? (
            <span aria-current="page" className={cn("truncate", c.mono && "font-mono text-xs")}>
              {c.label}
            </span>
          ) : (
            <Link
              href={c.href as Route}
              className={cn(
                "text-muted-foreground hover:text-foreground truncate transition-colors",
                c.mono && "font-mono text-xs",
              )}
            >
              {c.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function SidebarContent({
  org,
  orgs,
  user,
  appHost,
  onSearch,
  onNavigate,
}: Omit<Props, "children"> & { onSearch: () => void; onNavigate: () => void }) {
  const pathname = usePathname();
  const base = `/${org.slug}`;
  const nav = [
    { href: base, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `${base}/endpoints`, label: "Endpoints", icon: Webhook },
    { href: `${base}/deliveries`, label: "Deliveries", icon: Send },
    { href: `${base}/usage`, label: "Usage", icon: ChartColumn },
    {
      href: `${base}/settings/general`,
      label: "Settings",
      icon: Settings,
      match: `${base}/settings`,
    },
  ];

  return (
    <div className="flex h-full w-full flex-col gap-3 p-3">
      <OrgSwitcher org={org} orgs={orgs} appHost={appHost} />
      <button
        type="button"
        onClick={onSearch}
        className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors"
      >
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="bg-muted rounded border px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <nav aria-label="Main" className="mt-1 grid gap-0.5">
        {nav.map(({ href, label, icon: Icon, exact, match }) => {
          const active = exact ? pathname === href : pathname.startsWith(match ?? href);
          return (
            <Link
              key={href}
              href={href as Route}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                active
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="app-nav-active"
                  className="bg-accent absolute inset-0 rounded-md"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="relative size-4" aria-hidden />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto grid gap-3">
        <UsageMeter orgSlug={org.slug} />
        <UserMenu user={user} />
      </div>
    </div>
  );
}

/** This month's requests against the plan. */
function UsageMeter({ orgSlug }: { orgSlug: string }) {
  const trpc = useTRPC();
  const { data } = useQuery({ ...trpc.usage.get.queryOptions({ orgSlug }), staleTime: 60_000 });
  if (!data) return <div className="bg-card/50 h-[74px] animate-pulse rounded-lg border" />;

  const { used, limit } = data.requests;
  const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
  return (
    <Link
      href={`/${orgSlug}/usage` as Route}
      className="bg-card/50 hover:border-primary/30 block rounded-lg border p-3 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Requests this month</span>
        <span className="text-muted-foreground font-mono text-[10px]">{data.planName}</span>
      </div>
      <p className="mt-1 font-mono text-xs">
        {used.toLocaleString("en-US")}
        <span className="text-muted-foreground">
          {" / "}
          {limit === null ? "∞" : limit.toLocaleString("en-US")}
        </span>
      </p>
      {limit !== null && (
        <div className="bg-muted mt-2 h-1 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </Link>
  );
}
