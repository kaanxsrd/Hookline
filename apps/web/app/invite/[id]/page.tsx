import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = {
  title: "Invitation",
  description: "Join an organization on Hookline.",
  robots: { index: false },
};

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const next = encodeURIComponent(`/invite/${id}`);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        Hookline
      </Link>
      <main className="w-full max-w-sm">
        {session ? (
          <AcceptInvitation id={id} email={session.user.email} />
        ) : (
          <div className="grid gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">You have been invited</h1>
            <p className="text-muted-foreground text-sm">
              Sign in, or create an account with the email address the invitation was sent to, to
              accept it.
            </p>
            <Button asChild>
              <Link href={`/sign-in?next=${next}`}>Sign in</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/sign-up?next=${next}`}>Create an account</Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
