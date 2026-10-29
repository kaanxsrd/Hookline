"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormMessage } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, authErrorMessage } from "@/lib/auth-client";

type Invitation = {
  organizationName: string;
  organizationSlug: string;
  inviterEmail: string;
  role: string;
  email: string;
};

export function AcceptInvitation({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    authClient.organization.getInvitation({ query: { id } }).then(({ data, error }) => {
      if (error || !data)
        setError("This invitation is invalid, expired, or for another email address.");
      else setInvitation(data as Invitation);
    });
  }, [id]);

  async function respond(accept: boolean) {
    setPending(true);
    const { error } = accept
      ? await authClient.organization.acceptInvitation({ invitationId: id })
      : await authClient.organization.rejectInvitation({ invitationId: id });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else router.push(accept && invitation ? `/${invitation.organizationSlug}` : "/dashboard");
  }

  if (error) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
        <FormMessage error={error} />
        <p className="text-muted-foreground text-sm">You are signed in as {email}.</p>
      </div>
    );
  }
  if (!invitation) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Join {invitation.organizationName}</h1>
      <p className="text-muted-foreground text-sm">
        {invitation.inviterEmail} invited you to join as {invitation.role === "admin" ? "an" : "a"}{" "}
        {invitation.role}.
      </p>
      <Button onClick={() => respond(true)} disabled={pending}>
        Accept invitation
      </Button>
      <Button variant="ghost" onClick={() => respond(false)} disabled={pending}>
        Decline
      </Button>
    </div>
  );
}
