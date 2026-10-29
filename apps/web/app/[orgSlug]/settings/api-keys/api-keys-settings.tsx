"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";

const SCOPES = [
  ["endpoints:read", "Read endpoints and destinations"],
  ["endpoints:write", "Create, change and delete endpoints and requests"],
  ["requests:read", "Read requests, bodies and deliveries"],
  ["requests:replay", "Replay requests and retry deliveries"],
  ["destinations:write", "Manage destinations"],
  ["tunnel", "Open CLI tunnels"],
] as const;
type Scope = (typeof SCOPES)[number][0];

const EXPIRY = [
  ["never", "Never"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "1 year"],
] as const;

function when(d: Date | null): string {
  return d
    ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";
}

export function ApiKeysSettings({ orgSlug }: { orgSlug: string }) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listOptions = trpc.apiKey.list.queryOptions({ orgSlug });
  const keys = useQuery(listOptions);
  const create = useMutation(trpc.apiKey.create.mutationOptions());
  const revoke = useMutation(trpc.apiKey.revoke.mutationOptions());

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["endpoints:read", "requests:read"]);
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number][0]>("90");
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await attempt(
      create.mutateAsync({
        orgSlug,
        name,
        scopes,
        expiresInDays: expiry === "never" ? null : (Number(expiry) as 30 | 90 | 365),
      }),
    );
    if (!res) return;
    setCreating(false);
    setCreated(res.key);
    setName("");
    await queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
  }

  async function confirmRevoke() {
    if (!revoking) return;
    if (!(await attempt(revoke.mutateAsync({ orgSlug, id: revoking.id })))) {
      toast.error(revoke.error?.message ?? "Could not revoke the key.");
      return;
    }
    toast.success(`${revoking.name} revoked`);
    setRevoking(null);
    await queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-muted-foreground max-w-xl text-sm">
          Keys authenticate the REST API (<code className="font-mono">/api/v1</code>) and the CLI.
          Each key acts for this organization with the scopes you give it. The key is shown once;
          Hookline stores only a hash.
        </p>
        <Button
          onClick={() => {
            create.reset();
            setCreating(true);
          }}
        >
          <Plus aria-hidden /> Create API key
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="hidden md:table-cell">Scopes</TableHead>
              <TableHead className="hidden sm:table-cell">Last used</TableHead>
              <TableHead className="hidden lg:table-cell">Expires</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.isPending && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {keys.data?.map((k) => (
              <TableRow key={k.id} data-testid="api-key-row">
                <TableCell>
                  <div className="font-medium">{k.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {k.creatorName ?? k.creatorEmail ?? "Unknown"} · {when(k.createdAt)}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex max-w-72 flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                  {k.lastUsedAt ? k.lastUsedAt.toLocaleString() : "Never"}
                </TableCell>
                <TableCell className="hidden text-xs lg:table-cell">
                  {k.expired ? (
                    <span className="text-destructive">Expired</span>
                  ) : (
                    when(k.expiresAt)
                  )}
                </TableCell>
                <TableCell>
                  {k.canRevoke && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRevoking({ id: k.id, name: k.name })}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {keys.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                  No API keys yet. `hookline login` creates one for the CLI.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Give it only the scopes it needs.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CI pipeline"
                maxLength={100}
                required
              />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Scopes</legend>
              {SCOPES.map(([scope, text]) => (
                <Label key={scope} className="flex items-start gap-2 font-normal">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(v) =>
                      setScopes((prev) => (v ? [...prev, scope] : prev.filter((s) => s !== scope)))
                    }
                    aria-label={scope}
                  />
                  <span className="grid">
                    <span className="font-mono text-xs">{scope}</span>
                    <span className="text-muted-foreground text-xs">{text}</span>
                  </span>
                </Label>
              ))}
            </fieldset>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-expiry`}>Expires</Label>
              <Select value={expiry} onValueChange={(v) => setExpiry(v as typeof expiry)}>
                <SelectTrigger id={`${id}-expiry`} aria-label="Expires">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormMessage error={create.error?.message ?? null} />
            <SubmitButton pending={create.isPending} disabled={scopes.length === 0}>
              Create key
            </SubmitButton>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" aria-hidden /> Copy your API key
            </DialogTitle>
            <DialogDescription>
              This is the only time it is shown. Store it in your secret manager.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted flex items-center gap-2 rounded-md py-1 pr-1 pl-3">
            <code data-testid="new-api-key" className="min-w-0 flex-1 truncate font-mono text-xs">
              {created}
            </code>
            {created && <CopyButton value={created} label="Copy API key" />}
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.name}?</DialogTitle>
            <DialogDescription>
              Anything using this key, including CLI sessions, stops working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRevoke} disabled={revoke.isPending}>
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
