import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/** First path segments reachable without signing in. Everything else is the app. */
const PUBLIC = new Set([
  "",
  "new",
  "e",
  "sign-in",
  "sign-up",
  "verify-email",
  "forgot-password",
  "reset-password",
  "two-factor",
  "invite",
  "docs",
  "pricing",
  "changelog",
  "security",
  "privacy",
  "terms",
  "status",
  "robots.txt",
  "sitemap.xml",
  "opengraph-image",
  "twitter-image",
  "icon",
]);

function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  // The live stream lives on the edge, a separate origin in development.
  const edge = process.env.EDGE_PUBLIC_URL ? new URL(process.env.EDGE_PUBLIC_URL).origin : "";
  return [
    "default-src 'self'",
    // React needs eval only for development error overlays.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Radix, Sonner and Motion position and animate through inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${edge}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1] ?? "";

  if (!PUBLIC.has(first) && !getSessionCookie(request, { cookiePrefix: "hookline" })) {
    // Optimistic check only: pages verify the session on the server.
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // Caddy adds HSTS too; this covers deployments without it (e.g. Fly.io).
  if (process.env.APP_URL?.startsWith("https://")) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, static files and prefetches need neither.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
