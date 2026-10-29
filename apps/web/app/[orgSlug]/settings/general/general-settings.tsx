"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";

type Props = {
  org: { slug: string; name: string };
  canEdit: boolean;
  canDelete: boolean;
  appHost: string;
};

export function GeneralSettings({ org, canEdit, canDelete, appHost }: Props) {
  const router = useRouter();
  const trpc = useTRPC();
  const update = useMutation(trpc.org.update.mutationOptions());
  const remove = useMutation(trpc.org.delete.mutationOptions());
  const [confirm, setConfirm] = useState("");

  async function save(form: FormData) {
    const result = await attempt(
      update.mutateAsync({
        orgSlug: org.slug,
        name: String(form.get("name")),
        slug: String(form.get("slug")),
      }),
    );
    if (!result) return;
    const { slug } = result;
    toast.success("Saved");
    if (slug !== org.slug) router.replace(`/${slug}/settings/general`);
    else router.refresh();
  }

  return (
    <div className="grid max-w-2xl gap-10">
      <form action={save} className="grid gap-4">
        <Field
          label="Name"
          id="name"
          defaultValue={org.name}
          required
          maxLength={80}
          disabled={!canEdit}
        />
        <Field
          label="URL"
          id="slug"
          defaultValue={org.slug}
          required
          maxLength={40}
          disabled={!canEdit}
          hint={`${appHost}/<url>. Changing it breaks existing links to the dashboard; endpoint URLs do not change.`}
        />
        <FormMessage error={update.error?.message ?? null} />
        {canEdit && (
          <SubmitButton pending={update.isPending} className="justify-self-start">
            Save
          </SubmitButton>
        )}
      </form>

      {canDelete && (
        <section className="border-destructive/40 grid gap-3 rounded-lg border p-4">
          <h2 className="text-destructive font-medium">Delete organization</h2>
          <p className="text-muted-foreground text-sm">
            Deletes every endpoint, captured request, destination, API key and member link. This
            cannot be undone.
          </p>
          <Dialog onOpenChange={() => setConfirm("")}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="justify-self-start">
                Delete organization
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {org.name}?</DialogTitle>
                <DialogDescription>
                  Type <strong>{org.slug}</strong> to confirm.
                </DialogDescription>
              </DialogHeader>
              <Input
                aria-label="Organization URL"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <FormMessage error={remove.error?.message ?? null} />
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={confirm !== org.slug || remove.isPending}
                  onClick={async () => {
                    const removed = await attempt(
                      remove.mutateAsync({ orgSlug: org.slug, confirm }),
                    );
                    if (!removed) return;
                    window.location.href = "/dashboard";
                  }}
                >
                  Delete forever
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}
    </div>
  );
}
