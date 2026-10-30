import type { ReactNode } from "react";
import { Spotlight } from "@/components/aceternity/spotlight-new";
import { cn } from "@/lib/utils";

/** The header band of inner marketing pages: grid, spotlight, eyebrow, title, lede. */
export function PageHero({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative isolate overflow-hidden border-b", className)}>
      <div aria-hidden className="bg-grid mask-radial absolute inset-0 -z-10 opacity-70" />
      <div
        aria-hidden
        className="from-primary/20 absolute top-[-40%] left-1/2 -z-10 h-[28rem] w-[50rem] -translate-x-1/2 rounded-full bg-radial to-transparent to-70% blur-3xl"
      />
      <Spotlight />
      <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24 sm:pb-20">
        <p className="text-primary font-mono text-xs tracking-[0.2em] uppercase">{eyebrow}</p>
        <h1 className="text-gradient mt-3 max-w-3xl text-4xl font-semibold tracking-tighter text-balance sm:text-6xl">
          {title}
        </h1>
        {children && (
          <div className="text-muted-foreground mt-5 max-w-2xl text-lg text-pretty">{children}</div>
        )}
      </div>
    </div>
  );
}
