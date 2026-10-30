"use client";

// Adapted from Aceternity UI's Infinite Moving Cards
// (https://ui.aceternity.com/components/infinite-moving-cards): a looping
// marquee. Items render twice (the second copy hidden from assistive tech) so
// the CSS animation can wrap seamlessly; it pauses on hover and stops for
// reduced motion (globals.css).
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

const durations = { fast: "25s", normal: "45s", slow: "80s" };

export function InfiniteMovingCards({
  items,
  direction = "left",
  speed = "normal",
  className,
}: {
  items: { id: string; content: ReactNode }[];
  direction?: "left" | "right";
  speed?: keyof typeof durations;
  className?: string;
}) {
  const style = {
    "--animation-duration": durations[speed],
    "--animation-direction": direction === "left" ? "forwards" : "reverse",
  } as CSSProperties;

  return (
    <div
      style={style}
      className={cn(
        "relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,white_15%,white_85%,transparent)]",
        className,
      )}
    >
      <ul className="animate-scroll flex w-max min-w-full shrink-0 flex-nowrap gap-4 py-2 hover:[animation-play-state:paused]">
        {[...items, ...items].map((item, i) => (
          <li
            key={`${item.id}-${i < items.length ? "a" : "b"}`}
            className="shrink-0"
            aria-hidden={i >= items.length || undefined}
          >
            {item.content}
          </li>
        ))}
      </ul>
    </div>
  );
}
