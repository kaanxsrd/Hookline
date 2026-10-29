import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { AuthorizeCli } from "./authorize-cli";

export const metadata: Metadata = {
  title: "Authorize the CLI",
  description: "Approve a `hookline login` request.",
  robots: { index: false },
};

export default async function AuthorizeCliPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;
  const initial = typeof code === "string" ? code.slice(0, 16) : "";
  await requireSession(`/cli/authorize${initial ? `?code=${encodeURIComponent(initial)}` : ""}`);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        Hookline
      </Link>
      <main className="w-full max-w-md">
        <AuthorizeCli initialCode={initial} />
      </main>
    </div>
  );
}
