"use client";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export const Meteors = ({ number, className }: { number?: number; className?: string }) => {
  const meteors = new Array(number || 20).fill(true);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      {meteors.map((_el, idx) => {
        const meteorCount = number || 20;
        // Calculate position to evenly distribute meteors across container width
        const position = idx * (800 / meteorCount) - 400; // Spread across 800px range, centered

        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of identical decorations
            key={`meteor${idx}`}
            className={cn(
              "animate-meteor-effect absolute h-0.5 w-0.5 rotate-[45deg] rounded-[9999px] bg-slate-500 shadow-[0_0_0_1px_#ffffff10]",
              "before:absolute before:top-1/2 before:h-[1px] before:w-[50px] before:-translate-y-[50%] before:transform before:bg-gradient-to-r before:from-[#64748b] before:to-transparent before:content-['']",
              className,
            )}
            style={{
              top: "-40px", // Start above the container
              left: `${position}px`,
              // Deterministic spread (not Math.random) so server and client render the same.
              animationDelay: `${((idx * 37) % 50) / 10}s`,
              animationDuration: `${5 + ((idx * 13) % 5)}s`,
            }}
          ></span>
        );
      })}
    </motion.div>
  );
};
