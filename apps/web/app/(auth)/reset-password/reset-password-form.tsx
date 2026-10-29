"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading, Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <>
        <AuthHeading title="Link expired">This reset link is invalid or has expired.</AuthHeading>
        <Link href="/forgot-password" className="text-primary text-sm hover:underline">
          Request a new link
        </Link>
      </>
    );
  }

  async function onSubmit(form: FormData) {
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The passwords don't match.");
      return;
    }
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else router.push("/sign-in");
  }

  return (
    <>
      <AuthHeading title="Choose a new password">This signs you out everywhere else.</AuthHeading>
      <form action={onSubmit} className="grid gap-4">
        <Field
          label="New password"
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <Field
          label="Repeat it"
          id="confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <FormMessage error={error} />
        <SubmitButton pending={pending}>Save password</SubmitButton>
      </form>
    </>
  );
}
