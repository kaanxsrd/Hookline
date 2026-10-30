import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A small filled line chart (no axes), for trends in metric cards. Server-
 * renderable: the shape comes straight from the values.
 */
export function AreaChart({
  values,
  label,
  className,
}: {
  values: number[];
  label: string;
  className?: string;
}) {
  const id = useId();
  const w = 300;
  const h = 64;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values.map((v, i) => [i * step, h - 4 - (v / max) * (h - 8)] as const);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("text-primary h-16 w-full", className)}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
