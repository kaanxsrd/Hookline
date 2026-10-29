import type { Route } from "next";

export type DocsLink = { href: Route; title: string };

/** The docs sidebar, in reading order (the pager follows it too). */
export const DOCS_NAV: { title: string; links: DocsLink[] }[] = [
  {
    title: "Getting started",
    links: [{ href: "/docs", title: "Introduction" }],
  },
  {
    title: "Guides",
    links: [
      { href: "/docs/endpoints", title: "Endpoints" },
      { href: "/docs/inbox", title: "Inbox" },
      { href: "/docs/cli", title: "CLI and tunnels" },
      { href: "/docs/destinations", title: "Destinations" },
      { href: "/docs/replay", title: "Replay" },
      { href: "/docs/signatures", title: "Signature verification" },
    ],
  },
  {
    title: "API",
    links: [
      { href: "/docs/rest-api", title: "REST API" },
      { href: "/docs/api", title: "API reference" },
    ],
  },
  {
    title: "Accounts",
    links: [
      { href: "/docs/organizations", title: "Organizations and roles" },
      { href: "/docs/plans", title: "Plans and limits" },
    ],
  },
  {
    title: "Operating Hookline",
    links: [{ href: "/docs/self-hosting", title: "Self-hosting" }],
  },
];

export const DOCS_PAGES: DocsLink[] = DOCS_NAV.flatMap((s) => s.links);
