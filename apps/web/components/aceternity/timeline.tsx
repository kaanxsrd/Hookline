"use client";

// Adapted from Aceternity UI's Timeline (https://ui.aceternity.com/components/timeline):
// a beam that fills as the page scrolls past the entries.
import { motion, useScroll, useTransform } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type TimelineEntry = { id: string; title: ReactNode; content: ReactNode };

export function Timeline({ data }: { data: TimelineEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 10%", "end 50%"],
  });
  const heightTransform = useTransform(scrollYProgress, [0, 1], [0, height]);
  const opacityTransform = useTransform(scrollYProgress, [0, 0.1], [0, 1]);

  return (
    <div className="w-full" ref={containerRef}>
      <div ref={ref} className="relative pb-10">
        {data.map((item) => (
          <div key={item.id} className="flex justify-start pt-10 md:gap-10 md:pt-24">
            <div className="sticky top-28 z-10 flex max-w-xs flex-col items-center self-start md:w-full md:flex-row lg:max-w-sm">
              <div className="bg-background absolute left-3 flex size-10 items-center justify-center rounded-full">
                <div className="border-primary/40 bg-primary/20 size-4 rounded-full border" />
              </div>
              <h3 className="text-muted-foreground hidden font-mono text-xl font-semibold md:block md:pl-20 md:text-3xl">
                {item.title}
              </h3>
            </div>
            <div className="relative w-full pr-4 pl-20 md:pl-4">
              <h3 className="text-muted-foreground mb-4 block font-mono text-2xl font-semibold md:hidden">
                {item.title}
              </h3>
              {item.content}
            </div>
          </div>
        ))}
        <div
          style={{ height: `${height}px` }}
          className="via-border absolute top-0 left-8 w-[2px] overflow-hidden bg-[linear-gradient(to_bottom,var(--tw-gradient-stops))] from-transparent to-transparent [mask-image:linear-gradient(to_bottom,transparent_0%,black_10%,black_90%,transparent_100%)]"
        >
          <motion.div
            style={{ height: heightTransform, opacity: opacityTransform }}
            className="from-primary via-brand-cyan absolute inset-x-0 top-0 w-[2px] rounded-full bg-gradient-to-t to-transparent"
          />
        </div>
      </div>
    </div>
  );
}
