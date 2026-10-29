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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";

type Props = {
  orgSlug: string;
  canEdit: boolean;
  endpoint: {
    slug: string;
    name: string;
    description: string;
    status: "active" | "paused" | "disabled_by_admin";
  };
};

export function EndpointSettingsForm({ orgSlug, canEdit, endpoint }: Props) {
  const router = useRouter();
  const trpc = useTRPC();
  const update = useMutation(trpc.endpoint.update.mutationOptions());
  const remove = useMutation(trpc.endpoint.delete.mutationOptions());
  const [confirm, setConfirm] = useState("");

  async function save(form: FormData) {
    const saved = await attempt(
      update.mutateAsync({
        orgSlug,
        slug: endpoint.slug,
        name: String(form.get("name")),
        description: String(form.get("description") ?? ""),
      }),
    );
    if (!saved) return;
    toast.success("Saved");
    router.refresh();
  }

  async function toggleStatus() {
    const status = endpoint.status === "paused" ? "active" : "paused";
    if (!(await attempt(update.mutateAsync({ orgSlug, slug: endpoint.slug, status })))) {
      toast.error(update.error?.message ?? "Could not change the status.");
      return;
    }
    toast.success(status === "paused" ? "Endpoint paused" : "Endpoint resumed");
    router.refresh();
  }

  return (
    <div className="grid max-w-2xl gap-10">
      <section className="grid gap-4">
        <h2 className="font-medium">General</h2>
        <form action={save} className="grid gap-4">
          <Field
            label="Name"
            id="name"
            defaultValue={endpoint.name}
            required
            maxLength={80}
            disabled={!canEdit}
          />
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={endpoint.description}
              maxLength={500}
              rows={3}
              disabled={!canEdit}
            />
          </div>
          <FormMessage error={update.error?.message ?? null} />
          {canEdit && (
            <SubmitButton pending={update.isPending} className="justify-self-start">
              Save
            </SubmitButton>
          )}
        </form>
      </section>

      {canEdit && endpoint.status !== "disabled_by_admin" && (
        <section className="grid gap-3">
          <h2 className="font-medium">{endpoint.status === "paused" ? "Resume" : "Pause"}</h2>
          <p className="text-muted-foreground text-sm">
            {endpoint.status === "paused"
              ? "Start capturing again."
              : "While paused, senders get 410 Gone and nothing is captured."}
          </p>
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={toggleStatus}
            disabled={update.isPending}
          >
            {endpoint.status === "paused" ? "Resume endpoint" : "Pause endpoint"}
          </Button>
        </section>
      )}

      {canEdit && (
        <section className="border-destructive/40 grid gap-3 rounded-lg border p-4">
          <h2 className="text-destructive font-medium">Delete endpoint</h2>
          <p className="text-muted-foreground text-sm">
            Deletes the URL and every captured request, destination and delivery. This cannot be
            undone.
          </p>
          <Dialog onOpenChange={() => setConfirm("")}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="justify-self-start">
                Delete endpoint
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {endpoint.name}?</DialogTitle>
                <DialogDescription>
                  Type <strong>{endpoint.name}</strong> to confirm.
                </DialogDescription>
              </DialogHeader>
              <Input
                aria-label="Endpoint name"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <FormMessage error={remove.error?.message ?? null} />
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={confirm !== endpoint.name || remove.isPending}
                  onClick={async () => {
                    const removed = await attempt(
                      remove.mutateAsync({ orgSlug, slug: endpoint.slug, confirm }),
                    );
                    if (!removed) return;
                    toast.success("Endpoint deleted");
                    router.push(`/${orgSlug}/endpoints`);
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
