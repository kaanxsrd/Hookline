"use client";

import {
  ArrowLeft,
  Building2,
  LayoutDashboard,
  Menu,
  ScrollText,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import type { ShellUser } from "@/components/app-shell/app-shell";
import { UserMenu } from "@/components/app-shell/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV: { href: Route; label: string; icon: typeof Users; exact?: boolean }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/endpoints", label: "Endpoints", icon: Webhook },
  { href: "/admin/audit-log", label: "Audit log", icon: ScrollText },
];

/** Layout of the instance administration area: its own sidebar, no organization. */
export function AdminShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const sidebar = <Sidebar user={user} onNavigate={() => setOpen(false)} />;
  return (
    <div className="flex min-h-dvh">
      <aside className="bg-card/40 sticky top-0 hidden h-dvh w-60 shrink-0 border-r md:flex">
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Administration</SheetTitle>
              {sidebar}
            </SheetContent>
          </Sheet>
          <span className="font-medium">Administration</span>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ user, onNavigate }: { user: ShellUser; onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full w-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <ShieldCheck className="text-primary size-5" aria-hidden />
        <span className="font-semibold">Administration</span>
      </div>
      <nav aria-label="Administration" className="grid gap-1">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
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
      <div className="mt-auto grid gap-2">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-2.5 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to the app
        </Link>
        <UserMenu user={user} />
      </div>
    </div>
  );
}
