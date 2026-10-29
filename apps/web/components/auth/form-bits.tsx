"use client";

import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/hooks/use-hydrated";

export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="text-muted-foreground mt-2 text-sm">{children}</p>}
    </div>
  );
}

export function Field({
  label,
  id,
  hint,
  ...props
}: { label: string; id: string; hint?: ReactNode } & ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export function FormMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  if (error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
        {success}
      </p>
    );
  }
  return null;
}

export function SubmitButton({
  pending,
  children,
  disabled,
  ...props
}: { pending: boolean } & ComponentProps<typeof Button>) {
  const hydrated = useHydrated();
  return (
    <Button type="submit" disabled={pending || !hydrated || disabled} {...props}>
      {pending && <LoaderCircle className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
