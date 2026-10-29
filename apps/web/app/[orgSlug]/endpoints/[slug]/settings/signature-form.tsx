"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { attempt } from "@/lib/attempt";
import {
  PROVIDER_LABELS,
  SECRET_LABELS,
  SIGNATURE_PROVIDERS,
  type SignatureProvider,
} from "@/lib/signatures";
import { useTRPC } from "@/lib/trpc/client";

const NONE = "none";

/** Provider and secret for signature verification, with a test against the latest request. */
export function SignatureForm({
  orgSlug,
  slug,
  canEdit,
  provider: initialProvider,
  hasSecret,
}: {
  orgSlug: string;
  slug: string;
  canEdit: boolean;
  provider: SignatureProvider | null;
  hasSecret: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const trpc = useTRPC();
  const save = useMutation(trpc.endpoint.updateSignature.mutationOptions());
  const test = useMutation(trpc.endpoint.testSignature.mutationOptions());
  const [provider, setProvider] = useState<SignatureProvider | typeof NONE>(
    initialProvider ?? NONE,
  );
  const [secret, setSecret] = useState("");

  const selected = provider === NONE ? null : provider;
  const keepsSecret = hasSecret && selected === initialProvider;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await attempt(
      save.mutateAsync({ orgSlug, slug, provider: selected, ...(secret ? { secret } : {}) }),
    );
    if (!res) return;
    setSecret("");
    toast.success(selected ? "Verification saved" : "Verification turned off");
    router.refresh();
  }

  return (
    <section className="grid gap-4" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="font-medium">
          Signature verification
        </h2>
        <p className="text-muted-foreground text-sm">
          Requests are marked Verified or Invalid at capture. Nothing is rejected: the sender always
          gets your response.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-provider`}>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v as SignatureProvider | typeof NONE);
                test.reset();
              }}
              disabled={!canEdit}
            >
              <SelectTrigger id={`${id}-provider`} aria-label="Signature provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No verification</SelectItem>
                {SIGNATURE_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-secret`}>{SECRET_LABELS[selected]}</Label>
              <Input
                id={`${id}-secret`}
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={keepsSecret ? "Stored (enter a new one to replace it)" : ""}
                required={!keepsSecret}
                disabled={!canEdit}
                className="font-mono text-xs"
              />
            </div>
          )}
        </div>
        {selected && !hasSecret && initialProvider === selected && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Add the secret to start verifying: until then requests stay Unchecked.
          </p>
        )}

        <FormMessage error={save.error?.message ?? null} />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={save.isPending}>Save verification</SubmitButton>
            {selected && (
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || (!secret && !keepsSecret)}
                onClick={() =>
                  test.mutate({ orgSlug, slug, provider: selected, ...(secret ? { secret } : {}) })
                }
              >
                <FlaskConical aria-hidden /> Test against the last request
              </Button>
            )}
          </div>
        )}
        {test.error && <FormMessage error={test.error.message} />}
        {test.data && (
          <div
            role="status"
            data-testid="signature-test-result"
            className="flex items-start gap-2 rounded-lg border p-3 text-sm"
          >
            {test.data.verified ? (
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <div className="grid gap-0.5">
              <span className="font-medium">{test.data.verified ? "Verified" : "Invalid"}</span>
              {test.data.message && <span>{test.data.message}</span>}
              <span className="text-muted-foreground font-mono text-xs">
                {test.data.method} {test.data.path} ·{" "}
                {new Date(test.data.receivedAt).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
