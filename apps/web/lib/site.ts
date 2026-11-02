import type { Route } from "next";

/** Where the source lives (the CLI's buildinfo names the same repository). */
export const REPOSITORY_URL = "https://github.com/kaanxsrd/Hookline";

/**
 * An absolute URL on this instance. Reads APP_URL directly, like the root
 * layout, so it also works where the full server environment is not set.
 */
export function publicUrl(path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return path === "/" ? base : `${base}${path}`;
}

/** The marketing header's links. */
export const MARKETING_NAV: { href: Route; label: string }[] = [
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/changelog", label: "Changelog" },
];

/** The marketing footer's columns. */
export const FOOTER_LINKS: { title: string; links: { href: Route; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/new", label: "Get a webhook URL" },
      { href: "/pricing", label: "Pricing" },
      { href: "/changelog", label: "Changelog" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Getting started" },
      { href: "/docs/cli", label: "CLI" },
      { href: "/docs/rest-api", label: "REST API" },
      { href: "/docs/api", label: "API reference" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];
