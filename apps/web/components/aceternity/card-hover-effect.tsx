"use client";

// Adapted from Aceternity UI's Card Hover Effect (https://ui.aceternity.com/components/card-hover-effect):
// a highlight that glides between cards as the pointer moves.
import { AnimatePresence, motion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export type HoverCardItem = { title: string; description: string; href: Route; icon?: ReactNode };

export function HoverEffect({ items, className }: { items: HoverCardItem[]; className?: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((item, idx) => (
        <Link
          href={item.href}
          key={item.href}
          className="group relative block h-full w-full p-2"
          onMouseEnter={() => setHovered(idx)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(idx)}
          onBlur={() => setHovered(null)}
        >
          <AnimatePresence>
            {hovered === idx && (
              <motion.span
                className="bg-primary/10 absolute inset-0 block h-full w-full rounded-2xl"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.2 } }}
              />
            )}
          </AnimatePresence>
          <div className="bg-card/80 group-hover:border-primary/40 relative z-20 h-full w-full overflow-hidden rounded-xl border p-5 backdrop-blur transition-colors">
            {item.icon && <div className="text-primary mb-3">{item.icon}</div>}
            <h3 className="font-medium tracking-tight">{item.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{item.description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
