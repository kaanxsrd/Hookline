"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading, Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { authClient, authErrorMessage, safeNext } from "@/lib/auth-client";

export function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/onboarding");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    const email = String(form.get("email"));
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      // Where the verification link signs the user in.
      callbackURL: next,
    });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else {
      router.push(
        `/verify-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
      );
    }
  }

  return (
    <>
      <AuthHeading title="Create your account">
        Already have one?{" "}
        <Link href="/sign-in" className="text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </AuthHeading>
      <form action={onSubmit} className="grid gap-4">
        <Field label="Name" id="name" autoComplete="name" required maxLength={100} />
        <Field label="Email" id="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          hint="At least 10 characters."
        />
        <FormMessage error={error} />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
      <p className="text-muted-foreground mt-6 text-xs">
        By signing up you agree to the{" "}
        <Link href="/terms" className="underline">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </>
  );
}
