import type { ReactNode } from "react";
import { TracingBeam } from "@/components/aceternity/tracing-beam";

/** Long-form pages written in MDX: security, privacy and terms. */
export default function ProseLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="bg-grid absolute inset-x-0 top-0 -z-10 h-[30rem] [mask-image:linear-gradient(to_bottom,black,transparent)] opacity-60"
      />
      <div
        aria-hidden
        className="from-primary/15 absolute top-[-10rem] left-1/2 -z-10 h-[24rem] w-[44rem] -translate-x-1/2 rounded-full bg-radial to-transparent to-70% blur-3xl"
      />
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <TracingBeam className="max-w-3xl">
          <article>{children}</article>
        </TracingBeam>
      </div>
    </div>
  );
}
