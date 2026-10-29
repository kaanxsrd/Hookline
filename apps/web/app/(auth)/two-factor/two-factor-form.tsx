"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthHeading, Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { authClient, authErrorMessage, safeNext } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    const code = String(form.get("code")).replace(/\s+/g, "");
    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice: trust })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice: trust });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else router.push(next);
  }

  return (
    <>
      <AuthHeading title="Two-factor authentication">
        {mode === "totp"
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of your backup codes. Each code works once."}
      </AuthHeading>
      <form action={onSubmit} className="grid gap-4">
        {mode === "totp" ? (
          <Field
            key="totp"
            label="Code"
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
            autoFocus
          />
        ) : (
          <Field key="backup" label="Backup code" id="code" autoComplete="off" required autoFocus />
        )}
        <div className="flex items-center gap-2">
          <Checkbox id="trust" checked={trust} onCheckedChange={(v) => setTrust(v === true)} />
          <Label htmlFor="trust" className="text-sm font-normal">
            Trust this device for 30 days
          </Label>
        </div>
        <FormMessage error={error} />
        <SubmitButton pending={pending}>Verify</SubmitButton>
      </form>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground mt-6 text-sm"
        onClick={() => {
          setMode(mode === "totp" ? "backup" : "totp");
          setError(null);
        }}
      >
        {mode === "totp" ? "Use a backup code instead" : "Use your authenticator app"}
      </button>
    </>
  );
}
