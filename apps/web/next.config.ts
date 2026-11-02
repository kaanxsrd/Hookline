import { readFileSync } from "node:fs";
import path from "node:path";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// In development the root .env is loaded by the dev script itself
// (scripts/with-env.ts): Next.js resets process.env before
// rendering, so loading it here would not reach server code.

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const { version } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

const config: NextConfig = {
  output: "standalone",
  // Shown on the marketing site, so it always matches the release.
  env: { NEXT_PUBLIC_APP_VERSION: version },
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@hookline/db", "@hookline/shared"],
  reactStrictMode: true,
  typedRoutes: true,
  // Docs, the changelog and the legal pages are MDX files under app/.
  pageExtensions: ["ts", "tsx", "mdx"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Plugins are named by string so Turbopack can load them.
const withMDX = createMDX({
  options: { remarkPlugins: ["remark-gfm"], rehypePlugins: ["rehype-slug"] },
});

export default withMDX(config);
