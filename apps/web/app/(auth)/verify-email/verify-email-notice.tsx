"use client";

import { MailCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading, FormMessage } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage, safeNext } from "@/lib/auth-client";

export function VerifyEmailNotice() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const next = safeNext(params.get("next"), "/onboarding");
  const linkError = params.get("error");
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, setPending] = useState(false);

  async function resend() {
    setPending(true);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: next });
    setPending(false);
    setMessage(
      error ? { error: authErrorMessage(error) } : { success: "A new link is on its way." },
    );
  }

  return (
    <>
      <MailCheck className="text-primary mb-4 size-8" aria-hidden />
      <AuthHeading title="Check your inbox">
        {email ? (
          <>
            We sent a verification link to <strong className="text-foreground">{email}</strong>.
          </>
        ) : (
          "We sent you a verification link."
        )}{" "}
        It expires in 24 hours.
      </AuthHeading>
      {linkError && (
        <FormMessage error="That link is invalid or has expired. Send a new one below." />
      )}
      <FormMessage error={message.error ?? null} success={message.success ?? null} />
      {email && (
        <Button variant="outline" className="mt-4 w-full" onClick={resend} disabled={pending}>
          Resend the email
        </Button>
      )}
    </>
  );
}
