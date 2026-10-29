import type { ReactNode } from "react";

/** Long-form pages written in MDX: security, privacy, terms and the changelog. */
export default function ProseLayout({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">{children}</article>
  );
}
