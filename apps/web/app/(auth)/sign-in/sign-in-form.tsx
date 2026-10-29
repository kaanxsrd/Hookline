"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading, Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage, safeNext } from "@/lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    // A two-factor challenge: the plugin navigates to /two-factor itself.
    else if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    else router.push(next);
  }

  async function withPasskey() {
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) setError(authErrorMessage(result.error));
    else router.push(next);
  }

  return (
    <>
      <AuthHeading title="Sign in">
        New here?{" "}
        <Link
          href={`/sign-up${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </AuthHeading>
      <form action={onSubmit} className="grid gap-4">
        <Field label="Email" id="email" type="email" autoComplete="email webauthn" required />
        <Field
          label="Password"
          id="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="-mt-2 text-right text-sm">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
        </div>
        <FormMessage error={error} />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
      <div className="text-muted-foreground my-6 flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" />
        or
        <span className="bg-border h-px flex-1" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={withPasskey}>
        <KeyRound aria-hidden />
        Sign in with a passkey
      </Button>
    </>
  );
}
