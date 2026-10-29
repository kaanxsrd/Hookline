import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s · Administration · Hookline" },
  robots: { index: false },
};

/**
 * Instance administration. Non-administrators get a 404, like any unknown
 * page; every procedure behind it checks `user.is_admin` again.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("/admin");
  if (!session.user.isAdmin || session.user.disabledAt) notFound();
  return (
    <AdminShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
        isAdmin: true,
      }}
    >
      {children}
    </AdminShell>
  );
}
