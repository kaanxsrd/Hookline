"use client";

// Adapted from Aceternity UI's Moving Border (https://ui.aceternity.com/components/moving-border):
// a glow that travels around the edge of a link-styled button.
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useTransform,
} from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

export function MovingBorderLink({
  href,
  children,
  className,
  duration = 3000,
}: {
  href: Route;
  children: ReactNode;
  className?: string;
  duration?: number;
}) {
  return (
    <Link
      href={href}
      className="group relative inline-flex h-11 overflow-hidden rounded-lg bg-transparent p-px"
    >
      <span className="absolute inset-0 rounded-lg">
        <MovingBorder duration={duration} rx="10%" ry="10%">
          <span className="block size-20 bg-[radial-gradient(var(--color-brand-cyan)_40%,transparent_60%)] opacity-90" />
        </MovingBorder>
      </span>
      <span
        className={cn(
          "bg-primary text-primary-foreground relative flex h-full w-full items-center justify-center gap-2 rounded-[calc(0.5rem-1px)] px-5 text-sm font-medium antialiased transition-opacity group-hover:opacity-90",
          className,
        )}
      >
        {children}
      </span>
    </Link>
  );
}

function MovingBorder({
  children,
  duration = 3000,
  rx,
  ry,
}: {
  children: ReactNode;
  duration?: number;
  rx?: string;
  ry?: string;
}) {
  const pathRef = useRef<SVGRectElement>(null);
  const progress = useMotionValue<number>(0);

  useAnimationFrame((time) => {
    const length = pathRef.current?.getTotalLength();
    if (length) progress.set((time * (length / duration)) % length);
  });

  const x = useTransform(progress, (val) => pathRef.current?.getPointAtLength(val).x ?? 0);
  const y = useTransform(progress, (val) => pathRef.current?.getPointAtLength(val).y ?? 0);
  const transform = useMotionTemplate`translateX(${x}px) translateY(${y}px) translateX(-50%) translateY(-50%)`;

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        className="absolute h-full w-full"
        width="100%"
        height="100%"
        aria-hidden
      >
        <rect fill="none" width="100%" height="100%" rx={rx} ry={ry} ref={pathRef} />
      </svg>
      <motion.span
        style={{ position: "absolute", top: 0, left: 0, display: "inline-block", transform }}
      >
        {children}
      </motion.span>
    </>
  );
}
