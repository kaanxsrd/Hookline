import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_PAGES } from "./docs-nav";

const app = path.resolve(import.meta.dirname, "../app");

/** The page file serving a /docs path, if any (guides live in the (guides) group). */
function pageFor(href: string): string | undefined {
  const rest = href.replace(/^\/docs\/?/, "");
  const candidates = [
    path.join(app, "docs", "(guides)", rest, "page.mdx"),
    path.join(app, "docs", rest, "page.tsx"),
  ];
  return candidates.find((c) => existsSync(c));
}

describe("docs navigation", () => {
  it("links only to pages that exist", () => {
    for (const { href } of DOCS_PAGES) expect(pageFor(href), href).toBeDefined();
  });

  it("lists every guide in the sidebar", () => {
    const guides = readdirSync(path.join(app, "docs", "(guides)"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/docs/${d.name}`);
    const linked = new Set(DOCS_PAGES.map((p) => p.href));
    for (const guide of guides) expect(linked.has(guide as never), guide).toBe(true);
  });
});
