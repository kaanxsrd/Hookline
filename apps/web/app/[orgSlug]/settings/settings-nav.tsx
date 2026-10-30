"use client";

import { motion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href as Route}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {active && (
              <motion.span
                layoutId="settings-tab"
                className="bg-foreground absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
