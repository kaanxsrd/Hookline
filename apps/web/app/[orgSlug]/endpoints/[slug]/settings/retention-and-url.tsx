"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormMessage, SubmitButton } from "@/components/auth/form-bits";
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
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";

function describeHours(h: number): string {
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const days = Math.round(h / 24);
  return `${days} days`;
}

/** Retention slider, capped by the plan. */
export function RetentionForm({
  orgSlug,
  slug,
  canEdit,
  hours,
  maxHours,
  plan,
}: {
  orgSlug: string;
  slug: string;
  canEdit: boolean;
  hours: number;
  maxHours: number;
  plan: string;
}) {
  const id = useId();
  const router = useRouter();
  const trpc = useTRPC();
  const save = useMutation(trpc.endpoint.updateRetention.mutationOptions());
  const [value, setValue] = useState(Math.min(hours, maxHours));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(await attempt(save.mutateAsync({ orgSlug, slug, hours: value })))) return;
    toast.success("Retention saved");
    router.refresh();
  }

  return (
    <section className="grid gap-4" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="font-medium">
          Retention
        </h2>
        <p className="text-muted-foreground text-sm">
          Requests older than this are deleted, with their stored bodies and deliveries. The {plan}{" "}
          plan allows up to {describeHours(maxHours)}.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-3">
        <div className="flex items-center gap-4">
          <input
            type="range"
            aria-label="Retention in hours"
            min={1}
            max={maxHours}
            step={maxHours > 72 ? 24 : 1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            disabled={!canEdit || maxHours <= 1}
            className="accent-primary w-full max-w-sm"
          />
          <span data-testid="retention-value" className="text-sm tabular-nums">
            {describeHours(value)}
          </span>
        </div>
        <FormMessage error={save.error?.message ?? null} />
        {canEdit && (
          <SubmitButton
            pending={save.isPending}
            className="justify-self-start"
            disabled={value === hours}
          >
            Save retention
          </SubmitButton>
        )}
      </form>
    </section>
  );
}

/** Replaces the endpoint's URL after a warning. */
export function RegenerateUrl({ orgSlug, slug }: { orgSlug: string; slug: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const regenerate = useMutation(trpc.endpoint.regenerateSlug.mutationOptions());
  const [open, setOpen] = useState(false);

  async function confirm() {
    const res = await attempt(regenerate.mutateAsync({ orgSlug, slug }));
    if (!res) return;
    setOpen(false);
    toast.success("New URL created", { description: res.url });
    router.replace(`/${orgSlug}/endpoints/${res.slug}/settings`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="justify-self-start">
          <RefreshCw aria-hidden /> Regenerate URL
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate the URL?</DialogTitle>
          <DialogDescription>
            The current URL stops working immediately: senders get 404 until you give them the new
            one. Captured requests, destinations and settings are kept.
          </DialogDescription>
        </DialogHeader>
        <FormMessage error={regenerate.error?.message ?? null} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={regenerate.isPending}>
            Regenerate URL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
