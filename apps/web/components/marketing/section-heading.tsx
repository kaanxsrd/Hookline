import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Eyebrow, title and lede for a marketing section. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
  center = false,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-primary font-mono text-xs tracking-[0.2em] uppercase">{eyebrow}</p>
      <h2
        id={id}
        className="text-gradient mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
      >
        {title}
      </h2>
      {children && (
        <p className="text-muted-foreground mt-4 text-base text-pretty sm:text-lg">{children}</p>
      )}
    </div>
  );
}
