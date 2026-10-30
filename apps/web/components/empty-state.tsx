import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What a list shows before it has anything in it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center overflow-hidden rounded-xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      <div aria-hidden className="bg-dots mask-radial absolute inset-0 -z-10 opacity-60" />
      <div className="bg-card flex size-11 items-center justify-center rounded-xl border shadow-sm">
        <Icon className="text-muted-foreground size-5" aria-hidden />
      </div>
      <p className="mt-4 font-medium">{title}</p>
      {children && (
        <p className="text-muted-foreground mt-1 max-w-sm text-sm text-pretty">{children}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
