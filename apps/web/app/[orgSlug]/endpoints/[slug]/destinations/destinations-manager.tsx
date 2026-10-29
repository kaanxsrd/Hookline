"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { KeyRound, MoreHorizontal, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/routers/_app";
import { DestinationForm, type DestinationValues, EMPTY_DESTINATION } from "./destination-form";

type ListOutput = inferRouterOutputs<AppRouter>["destination"]["list"];
type Destination = ListOutput["destinations"][number];

function describeFilter(f: Destination["filter"]): string {
  const parts: string[] = [];
  if (f.methods?.length) parts.push(f.methods.join("/"));
  for (const [k, v] of Object.entries(f.header_equals ?? {})) parts.push(`${k}: ${v}`);
  for (const [k, v] of Object.entries(f.json_path_equals ?? {})) {
    parts.push(`${k} = ${JSON.stringify(v)}`);
  }
  return parts.length ? parts.join(" · ") : "All requests";
}

function SecretDialog({
  secret,
  onClose,
}: {
  secret: { value: string; title: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{secret?.title}</DialogTitle>
          <DialogDescription>
            Your API verifies webhook-signature with this secret (any Standard Webhooks library
            works). Keep it private.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted flex items-center gap-2 rounded-md py-1 pr-1 pl-3">
          <code data-testid="signing-secret" className="min-w-0 flex-1 truncate font-mono text-xs">
            {secret?.value}
          </code>
          {secret && <CopyButton value={secret.value} label="Copy signing secret" />}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DestinationsManager({
  orgSlug,
  endpointSlug,
  canEdit,
  initial,
}: {
  orgSlug: string;
  endpointSlug: string;
  canEdit: boolean;
  initial: ListOutput;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listOptions = trpc.destination.list.queryOptions({ orgSlug, endpointSlug });
  const { data } = useQuery({ ...listOptions, initialData: initial });
  const refresh = () => queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

  const create = useMutation(trpc.destination.create.mutationOptions());
  const update = useMutation(trpc.destination.update.mutationOptions());
  const remove = useMutation(trpc.destination.delete.mutationOptions());
  const reveal = useMutation(trpc.destination.revealSecret.mutationOptions());
  const rotate = useMutation(trpc.destination.rotateSecret.mutationOptions());
  const sendTest = useMutation(trpc.destination.sendTest.mutationOptions());

  const [editing, setEditing] = useState<Destination | "new" | null>(null);
  const [deleting, setDeleting] = useState<Destination | null>(null);
  const [secret, setSecret] = useState<{ value: string; title: string } | null>(null);

  const atLimit = data.limit !== null && data.destinations.length >= data.limit;

  async function save(values: DestinationValues) {
    if (editing === "new") {
      const res = await attempt(create.mutateAsync({ orgSlug, endpointSlug, ...values }));
      if (!res) return;
      toast.success("Destination added");
      setEditing(null);
      if (res.signingSecret) setSecret({ value: res.signingSecret, title: "Signing secret" });
    } else if (editing) {
      const res = await attempt(update.mutateAsync({ orgSlug, id: editing.id, ...values }));
      if (!res) return;
      toast.success("Destination saved");
      setEditing(null);
      if (res.signingSecret) setSecret({ value: res.signingSecret, title: "Signing secret" });
    }
    await refresh();
  }

  async function toggle(d: Destination, enabled: boolean) {
    if (!(await attempt(update.mutateAsync({ orgSlug, id: d.id, enabled })))) {
      toast.error(update.error?.message ?? "Could not update the destination.");
      return;
    }
    toast.success(enabled ? `${d.name} enabled` : `${d.name} disabled`);
    await refresh();
  }

  async function test(d: Destination) {
    const res = await attempt(sendTest.mutateAsync({ orgSlug, id: d.id }));
    if (!res) {
      toast.error(sendTest.error?.message ?? "Could not send a test.");
      return;
    }
    toast.success("Test queued", {
      description: "The latest request is on its way; watch the delivery in the inbox.",
    });
    await refresh();
  }

  async function showSecret(d: Destination, rotateIt: boolean) {
    const res = await attempt(
      rotateIt
        ? rotate.mutateAsync({ orgSlug, id: d.id }).then((r) => r.secret)
        : reveal.mutateAsync({ orgSlug, id: d.id }).then((r) => r.secret),
    );
    if (!res) {
      toast.error((rotateIt ? rotate : reveal).error?.message ?? "Could not load the secret.");
      return;
    }
    setSecret({ value: res, title: rotateIt ? "New signing secret" : "Signing secret" });
  }

  async function confirmDelete() {
    if (!deleting) return;
    if (!(await attempt(remove.mutateAsync({ orgSlug, id: deleting.id })))) {
      toast.error(remove.error?.message ?? "Could not delete the destination.");
      return;
    }
    toast.success(`${deleting.name} deleted`);
    setDeleting(null);
    await refresh();
  }

  const formError =
    editing === "new" ? (create.error?.message ?? null) : (update.error?.message ?? null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {data.destinations.length}
          {data.limit !== null ? ` of ${data.limit}` : ""} destination
          {data.destinations.length === 1 && data.limit === null ? "" : "s"}
          {atLimit ? ". Upgrade your plan to add more." : ""}
        </p>
        {canEdit && (
          <Button
            onClick={() => {
              create.reset();
              setEditing("new");
            }}
            disabled={atLimit}
          >
            <Plus aria-hidden /> Add destination
          </Button>
        )}
      </div>

      {data.destinations.length === 0 && (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          No destinations yet. Add one to forward every captured request to your API, with retries.
        </div>
      )}

      <ul className="grid gap-3">
        {data.destinations.map((d) => (
          <li
            key={d.id}
            data-testid="destination"
            className="bg-card grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto]"
          >
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.name}</span>
                {!d.enabled && <Badge variant="outline">Disabled</Badge>}
                {d.signWithStandardWebhooks && (
                  <Badge variant="secondary" className="gap-1">
                    <KeyRound className="size-3" aria-hidden /> Signed
                  </Badge>
                )}
              </div>
              <code className="text-muted-foreground truncate font-mono text-xs">{d.url}</code>
              <p className="text-muted-foreground truncate text-xs">{describeFilter(d.filter)}</p>
              <p className="text-xs" data-testid="destination-stats">
                {d.stats.total === 0 ? (
                  <span className="text-muted-foreground">No deliveries in the last 7 days</span>
                ) : (
                  <>
                    <span
                      className={
                        d.stats.successRate !== null && d.stats.successRate < 0.9
                          ? "text-destructive"
                          : "text-emerald-700 dark:text-emerald-300"
                      }
                    >
                      {d.stats.successRate === null
                        ? "—"
                        : `${Math.round(d.stats.successRate * 1000) / 10}% delivered`}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {d.stats.succeeded} ok · {d.stats.failed} failed
                      {d.stats.pending ? ` · ${d.stats.pending} retrying` : ""} (7 days)
                    </span>
                  </>
                )}
              </p>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2 self-start">
                <Switch
                  checked={d.enabled}
                  onCheckedChange={(v) => toggle(d, v)}
                  aria-label={`${d.enabled ? "Disable" : "Enable"} ${d.name}`}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => test(d)}
                  disabled={sendTest.isPending}
                >
                  <Send aria-hidden /> Send test
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`More actions for ${d.name}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        update.reset();
                        setEditing(d);
                      }}
                    >
                      <Pencil aria-hidden /> Edit
                    </DropdownMenuItem>
                    {d.hasSigningSecret && (
                      <>
                        <DropdownMenuItem onSelect={() => showSecret(d, false)}>
                          <KeyRound aria-hidden /> Reveal signing secret
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => showSecret(d, true)}>
                          <KeyRound aria-hidden /> Rotate signing secret
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                      <Trash2 aria-hidden /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add destination" : "Edit destination"}</DialogTitle>
            <DialogDescription>
              Captured requests are forwarded with their method, path suffix, query, headers and
              body.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <DestinationForm
              key={editing === "new" ? "new" : editing.id}
              initial={editing === "new" ? EMPTY_DESTINATION : editing}
              submitLabel={editing === "new" ? "Add destination" : "Save"}
              pending={create.isPending || update.isPending}
              error={formError}
              onSubmit={save}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Its delivery history is deleted too. Requests stay in the inbox.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={remove.isPending}>
              Delete destination
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}
