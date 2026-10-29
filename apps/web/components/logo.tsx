import { cn } from "@/lib/utils";

/** The Hookline mark: a hook catching a line. Drawn in currentColor. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("size-6", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M11 6v12a5 5 0 0 0 10 0v-3"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="text-primary-foreground"
      />
      <path
        d="M17.5 14.5 21 11l3.5 3.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary-foreground"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      Hookline
    </span>
  );
}
