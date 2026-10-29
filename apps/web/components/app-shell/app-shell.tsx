"use client";

import { LayoutDashboard, Menu, Search, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

export type ShellOrg = { slug: string; name: string; role: string; plan: string };
export type ShellUser = { name: string; email: string; image: string | null };

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
      <aside className="bg-card/40 sticky top-0 hidden h-dvh w-60 shrink-0 border-r md:flex">
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
          <span className="truncate font-medium">{org.name}</span>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <CommandPalette org={org} open={palette.open} onOpenChange={palette.setOpen} />
    </div>
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
    {
      href: `${base}/settings/general`,
      label: "Settings",
      icon: Settings,
      match: `${base}/settings`,
    },
  ];

  return (
    <div className="flex h-full w-full flex-col gap-4 p-3">
      <OrgSwitcher org={org} orgs={orgs} appHost={appHost} />
      <button
        type="button"
        onClick={onSearch}
        className="text-muted-foreground hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="bg-muted rounded px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <nav aria-label="Main" className="grid gap-1">
        {nav.map(({ href, label, icon: Icon, exact, match }) => {
          const active = exact ? pathname === href : pathname.startsWith(match ?? href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <UserMenu user={user} />
      </div>
    </div>
  );
}
