import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Hookline: catch every webhook, replay anything, pipe it to localhost",
    template: "%s · Hookline",
  },
  description:
    "Hookline gives you a URL that captures any HTTP request, shows it live, lets you inspect, replay and forward it, and pipes it to localhost through a CLI tunnel.",
  applicationName: "Hookline",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by proxy.ts for the Content-Security-Policy; inline scripts need it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
