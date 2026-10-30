import type { ReactNode } from "react";
import { DocsMobileNav } from "@/components/docs/docs-mobile-nav";
import { DocsPager, DocsSidebar } from "@/components/docs/docs-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="bg-grid absolute inset-x-0 top-0 -z-10 h-[34rem] [mask-image:linear-gradient(to_bottom,black,transparent)] opacity-50"
      />
      <div
        aria-hidden
        className="from-primary/15 absolute top-[-12rem] left-1/2 -z-10 h-[26rem] w-[56rem] -translate-x-1/2 rounded-full bg-radial to-transparent to-70% blur-3xl"
      />
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-4 sm:px-6">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto py-10 lg:block">
          <DocsSidebar />
        </aside>
        <main className="min-w-0 flex-1 py-10 lg:py-14">
          <div className="mb-6 lg:hidden">
            <DocsMobileNav />
          </div>
          <article className="max-w-3xl">{children}</article>
          <div className="max-w-3xl">
            <DocsPager />
          </div>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
