"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthHeading, Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [state, setState] = useState<{ error?: string; sent?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    setPending(true);
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // The same answer whether or not an account exists.
    setState(error ? { error: authErrorMessage(error) } : { sent: true });
  }

  return (
    <>
      <AuthHeading title="Reset your password">
        Enter your email and we will send you a link to choose a new password.
      </AuthHeading>
      {state.sent ? (
        <FormMessage success="If an account uses that email, a reset link is on its way. It expires in one hour." />
      ) : (
        <form action={onSubmit} className="grid gap-4">
          <Field label="Email" id="email" type="email" autoComplete="email" required />
          <FormMessage error={state.error ?? null} />
          <SubmitButton pending={pending}>Send reset link</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-sm">
        <Link href="/sign-in" className="text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
