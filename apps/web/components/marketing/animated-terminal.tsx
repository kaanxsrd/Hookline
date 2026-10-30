"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const COMMAND = "hookline listen k3Jx9QpL2mWa --forward http://localhost:3000/api/webhooks";

type Row = {
  time: string;
  path: string;
  status: number;
  ms: string;
  hint: string;
  replay?: boolean;
};

const ROWS: Row[] = [
  { time: "12:04:31", path: "/stripe", status: 200, ms: "38 ms", hint: "payment_intent.succeeded" },
  {
    time: "12:04:33",
    path: "/stripe",
    status: 200,
    ms: "21 ms",
    hint: "checkout.session.completed",
  },
  { time: "12:05:02", path: "/github", status: 500, ms: "112 ms", hint: "push" },
  { time: "12:05:40", path: "/github", status: 200, ms: "44 ms", hint: "push", replay: true },
  { time: "12:06:11", path: "/shopify", status: 200, ms: "29 ms", hint: "orders/create" },
];

/** `hookline listen` at work: the command types itself, then requests stream in. */
export function AnimatedTerminal({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduceMotion = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const [rows, setRows] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setTyped(COMMAND.length);
      setRows(ROWS.length + 1);
      return;
    }
    let i = 0;
    let streaming: ReturnType<typeof setInterval> | undefined;
    const typing = setInterval(() => {
      i += 2;
      setTyped(Math.min(i, COMMAND.length));
      if (i >= COMMAND.length) {
        clearInterval(typing);
        let r = 0;
        streaming = setInterval(() => {
          r += 1;
          setRows(r);
          if (r > ROWS.length) clearInterval(streaming);
        }, 650);
      }
    }, 28);
    return () => {
      clearInterval(typing);
      clearInterval(streaming);
    };
  }, [inView, reduceMotion]);

  const done = typed >= COMMAND.length;

  return (
    <motion.figure
      ref={ref}
      initial={{ opacity: 0, y: 40, rotateX: 18 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformPerspective: 1200 }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 text-left text-zinc-100 shadow-[0_0_80px_-20px_var(--primary)] backdrop-blur",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-amber-400/70" />
        <span className="size-2.5 rounded-full bg-emerald-400/70" />
        <figcaption className="ml-2 font-mono text-xs text-zinc-500">
          ~/my-app — hookline
        </figcaption>
      </div>
      <pre className="min-h-64 overflow-x-auto p-4 font-mono text-[12.5px] leading-6 sm:text-[13px]">
        <code>
          <span className="text-zinc-500">$ </span>
          {COMMAND.slice(0, typed)}
          {!done && (
            <span className="animate-caret ml-px inline-block h-4 w-2 translate-y-0.5 bg-zinc-300" />
          )}
          {rows > 0 && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="block">
              <span className="text-emerald-400">✓ </span>
              Forwarding{" "}
              <span className="text-indigo-300">https://hooks.vante.app/h/k3Jx9QpL2mWa</span>
              <span className="text-zinc-500"> → localhost:3000</span>
            </motion.span>
          )}
          {ROWS.slice(0, Math.max(0, rows - 1)).map((r) => (
            <motion.span
              key={`${r.time}${r.hint}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="block whitespace-pre"
            >
              <span className="text-zinc-500">{r.time}</span> POST /h/k3Jx9QpL2mWa{r.path}
              {r.replay && <span className="text-indigo-300"> (replay)</span>}
              {"  → "}
              <span className={r.status < 300 ? "text-emerald-400" : "text-red-400"}>
                {r.status}
              </span>
              <span className="text-zinc-500">
                {"  "}
                {r.ms}
                {"  "}
                {r.hint}
              </span>
            </motion.span>
          ))}
        </code>
      </pre>
    </motion.figure>
  );
}
