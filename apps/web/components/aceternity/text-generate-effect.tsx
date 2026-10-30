"use client";

// Adapted from Aceternity UI's Text Generate Effect
// (https://ui.aceternity.com/components/text-generate-effect): words fade in
// from a blur, one after another. With reduced motion the text simply shows.
import { motion, stagger, useAnimate, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function TextGenerateEffect({
  words,
  className,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  duration?: number;
}) {
  const [scope, animate] = useAnimate();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    animate(
      "span",
      { opacity: 1, filter: "blur(0px)" },
      reduceMotion ? { duration: 0 } : { duration, delay: stagger(0.06) },
    );
  }, [animate, duration, reduceMotion]);

  return (
    <motion.p ref={scope} className={cn(className)}>
      {words.split(" ").map((word, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words are positional; the text never reorders
        <span key={`${word}-${idx}`} className="opacity-0 blur-sm">
          {word}{" "}
        </span>
      ))}
    </motion.p>
  );
}
