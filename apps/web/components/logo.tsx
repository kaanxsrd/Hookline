"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** The hook, from the top of the stem round to the arrow tip: drawn, and travelled by the request. */
const HOOK = "M11 6V18A5 5 0 0 0 21 18V11";
const BARB = "M17.5 14.5 21 11l3.5 3.5";
/** One catch every few seconds: the request runs the hook, then the arrow pulses. */
const CYCLE = "4.2s";
const START = "1.4s";

/**
 * The Hookline mark: a hook catching a webhook. The hook draws itself in, a
 * request runs down it into the arrow every few seconds, and the tile swings
 * on hover. With reduced motion it is static (CSS, so server and client agree).
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();

  return (
    <motion.svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-6 shrink-0 overflow-visible", className)}
      whileHover={{ rotate: [0, -12, 7, -3, 0] }}
      transition={{ duration: 0.9, ease: "easeInOut" }}
      style={{ transformOrigin: "50% 0%" }}
    >
      <defs>
        <linearGradient
          id={`${id}-tile`}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--color-brand-cyan)" />
        </linearGradient>
        <linearGradient
          id={`${id}-shine`}
          x1="0"
          y1="0"
          x2="0"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="32" height="32" rx="8" fill={`url(#${id}-tile)`} />
      <rect width="32" height="32" rx="8" fill={`url(#${id}-shine)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="#fff" strokeOpacity="0.2" />

      <path
        d={HOOK}
        pathLength={1}
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-logo-draw"
      />
      <path
        d={BARB}
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-logo-barb"
      />

      <g className="motion-reduce:hidden">
        {/* The request: a bead with a glow, down the hook and up into the arrow. */}
        <g opacity="0">
          <circle r="3.4" fill="#fff" opacity="0.35" />
          <circle r="1.5" fill="#1e1b4b" />
          <animateMotion
            path={HOOK}
            dur={CYCLE}
            begin={START}
            repeatCount="indefinite"
            calcMode="spline"
            keyPoints="0;1;1"
            keyTimes="0;0.55;1"
            keySplines="0.45 0 0.25 1;0 0 1 1"
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0;0"
            keyTimes="0;0.06;0.52;0.58;1"
            dur={CYCLE}
            begin={START}
            repeatCount="indefinite"
          />
        </g>
        {/* Caught: a ring from the arrow tip as the request arrives. */}
        <circle cx="21" cy="11" r="0" stroke="#fff" strokeWidth="1.4" opacity="0">
          <animate
            attributeName="r"
            values="0;0;8;8"
            keyTimes="0;0.53;0.82;1"
            dur={CYCLE}
            begin={START}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;0;0.9;0;0"
            keyTimes="0;0.53;0.57;0.82;1"
            dur={CYCLE}
            begin={START}
            repeatCount="indefinite"
          />
        </circle>
      </g>
    </motion.svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span>
        Hook<span className="text-gradient-brand">line</span>
      </span>
    </span>
  );
}
