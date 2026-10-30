"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validOrgSlug } from "@/lib/permissions";
import type { ShellOrg } from "./app-shell";

export function OrgSwitcher({
  org,
  orgs,
  appHost,
}: {
  org: ShellOrg;
  orgs: { slug: string; name: string }[];
  appHost: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="hover:bg-accent/60 flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors">
          <span className="from-primary to-brand-cyan text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-xs font-semibold shadow-[0_0_16px_-4px_var(--primary)]">
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{org.name}</span>
            <span className="text-muted-foreground block font-mono text-[10px] tracking-wide uppercase">
              {org.plan} plan
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.slug} onSelect={() => router.push(`/${o.slug}`)}>
              <span className="flex-1 truncate">{o.name}</span>
              {o.slug === org.slug && <Check className="size-4" aria-hidden />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrgDialog open={creating} onOpenChange={setCreating} appHost={appHost} />
    </>
  );
}

function CreateOrgDialog({
  open,
  onOpenChange,
  appHost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appHost: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    const name = String(form.get("name"));
    if (!validOrgSlug(slug)) {
      setError("Use 3–40 lowercase letters, numbers and dashes for the URL.");
      return;
    }
    setPending(true);
    setError(null);
    const { data, error } = await authClient.organization.create({ name, slug });
    setPending(false);
    if (error || !data) {
      setError(authErrorMessage(error));
      return;
    }
    onOpenChange(false);
    router.push(`/${data.slug}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>
            Each organization has its own endpoints, members and plan.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-4">
          <Field
            label="Name"
            id="new-org-name"
            required
            maxLength={80}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 40),
              )
            }
          />
          <Field
            label="URL"
            id="new-org-slug"
            value={slug}
            required
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            hint={`${appHost}/${slug || "your-team"}`}
          />
          <FormMessage error={error} />
          <SubmitButton pending={pending}>Create organization</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
