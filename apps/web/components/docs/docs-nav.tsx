"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_NAV, DOCS_PAGES } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="grid gap-6 text-sm">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <h2 className="text-muted-foreground mb-2 px-3 font-mono text-[11px] tracking-widest uppercase">
            {section.title}
          </h2>
          <ul className="grid gap-0.5">
            {section.links.map(({ href, title }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => onNavigate?.()}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative block rounded-md px-3 py-1.5 transition-colors",
                      active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {active && (
                      // Slides between pages as the reader moves through the docs.
                      <motion.span
                        layoutId="docs-active"
                        className="bg-primary/10 border-primary/30 absolute inset-0 rounded-md border"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      >
                        <span className="from-primary to-brand-cyan absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b" />
                      </motion.span>
                    )}
                    <span className="relative">{title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Previous and next pages, following the sidebar's order. */
export function DocsPager() {
  const pathname = usePathname();
  const i = DOCS_PAGES.findIndex((p) => p.href === pathname);
  if (i < 0) return null;
  const prev = DOCS_PAGES[i - 1];
  const next = DOCS_PAGES[i + 1];
  return (
    <nav aria-label="Pages" className="mt-16 grid gap-4 border-t pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          href={prev.href}
          className="group bg-card/60 hover:border-primary/40 rounded-xl border p-4 transition-all hover:shadow-[0_0_30px_-12px_var(--primary)]"
        >
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ArrowLeft className="size-3" aria-hidden /> Previous
          </span>
          <span className="mt-1 block font-medium">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={next.href}
          className="group bg-card/60 hover:border-primary/40 rounded-xl border p-4 text-right transition-all hover:shadow-[0_0_30px_-12px_var(--primary)]"
        >
          <span className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
            Next <ArrowRight className="size-3" aria-hidden />
          </span>
          <span className="mt-1 block font-medium">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}
