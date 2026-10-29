import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/session";
import { AccountSettings } from "./account-settings";

export const metadata: Metadata = {
  title: "Account",
  description: "Your profile, password, passkeys, two-factor authentication and sessions.",
  robots: { index: false },
};

export default async function AccountPage() {
  const session = await requireSession("/account");
  return (
    <PageBody>
      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to the dashboard
      </Link>
      <PageHeader title="Account" description={session.user.email} />
      <AccountSettings
        user={{
          name: session.user.name,
          email: session.user.email,
          twoFactorEnabled: session.user.twoFactorEnabled === true,
        }}
        currentSessionToken={session.session.token}
      />
    </PageBody>
  );
}
