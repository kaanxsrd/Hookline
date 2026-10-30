"use client";

// Adapted from Aceternity UI's Lamp section (https://ui.aceternity.com/components/lamp-effect),
// in Hookline's indigo and cyan. Always dark: it reads as a lit band in both themes.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const grow = {
  initial: { opacity: 0.5, width: "15rem" },
  whileInView: { opacity: 1, width: "30rem" },
};
const transition = { delay: 0.2, duration: 0.8, ease: "easeInOut" } as const;

export function LampContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative z-0 flex w-full flex-col items-center justify-center overflow-hidden bg-zinc-950 text-zinc-50",
        className,
      )}
    >
      <div className="relative isolate z-0 flex h-[26rem] w-full scale-y-125 items-center justify-center">
        <motion.div
          {...grow}
          viewport={{ once: true }}
          transition={transition}
          style={{
            backgroundImage:
              "conic-gradient(from 70deg at center top, #6366f1, transparent, transparent)",
          }}
          className="absolute inset-auto right-1/2 h-56 w-[30rem] overflow-visible"
        >
          <div className="absolute bottom-0 left-0 z-20 h-40 w-full bg-zinc-950 [mask-image:linear-gradient(to_top,white,transparent)]" />
          <div className="absolute bottom-0 left-0 z-20 h-full w-40 bg-zinc-950 [mask-image:linear-gradient(to_right,white,transparent)]" />
        </motion.div>
        <motion.div
          {...grow}
          viewport={{ once: true }}
          transition={transition}
          style={{
            backgroundImage:
              "conic-gradient(from 290deg at center top, transparent, transparent, #22d3ee)",
          }}
          className="absolute inset-auto left-1/2 h-56 w-[30rem]"
        >
          <div className="absolute right-0 bottom-0 z-20 h-full w-40 bg-zinc-950 [mask-image:linear-gradient(to_left,white,transparent)]" />
          <div className="absolute right-0 bottom-0 z-20 h-40 w-full bg-zinc-950 [mask-image:linear-gradient(to_top,white,transparent)]" />
        </motion.div>
        <div className="absolute top-1/2 h-48 w-full translate-y-12 scale-x-150 bg-zinc-950 blur-2xl" />
        <div className="absolute top-1/2 z-50 h-48 w-full bg-transparent opacity-10 backdrop-blur-md" />
        <div className="absolute inset-auto z-50 h-36 w-[28rem] -translate-y-1/2 rounded-full bg-indigo-500 opacity-40 blur-3xl" />
        <motion.div
          initial={{ width: "8rem" }}
          whileInView={{ width: "16rem" }}
          viewport={{ once: true }}
          transition={transition}
          className="absolute inset-auto z-30 h-36 w-64 -translate-y-24 rounded-full bg-cyan-400/80 blur-2xl"
        />
        <motion.div
          initial={{ width: "15rem" }}
          whileInView={{ width: "30rem" }}
          viewport={{ once: true }}
          transition={transition}
          className="absolute inset-auto z-50 h-0.5 w-[30rem] -translate-y-28 bg-cyan-300"
        />
        <div className="absolute inset-auto z-40 h-44 w-full -translate-y-[12.5rem] bg-zinc-950" />
      </div>
      <div className="relative z-50 -mt-56 flex flex-col items-center px-5 pb-24">{children}</div>
    </div>
  );
}
