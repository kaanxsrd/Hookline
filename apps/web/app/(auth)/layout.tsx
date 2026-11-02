import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" aria-label="Hookline home" className="mb-8 text-lg">
        <Logo />
      </Link>
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
