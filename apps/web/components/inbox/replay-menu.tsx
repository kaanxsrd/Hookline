"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Pencil, Plus, Repeat, Send, Terminal, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export type ReplayEdit = {
  method: string;
  path: string;
  query: string;
  headers: [string, string][];
  body?: string;
  bodyBase64?: string;
};

export type ReplayDraft = {
  method: string;
  path: string;
  query: string;
  headers: [string, string][];
  body: string;
  bodyBase64: string | null;
  bodyEditable: boolean;
  bodySize: number;
};

/** What the inbox can do to replay a request (members only). */
export type ReplayActions = {
  targets: () => Promise<{
    destinations: { id: string; name: string; url: string; enabled: boolean }[];
    tunnels: number;
  }>;
  draft: (id: string) => Promise<ReplayDraft>;
  toDestination: (id: string, destinationId: string, edit?: ReplayEdit) => Promise<unknown>;
  toCli: (id: string, edit?: ReplayEdit) => Promise<unknown>;
};

const CLI = "cli";

async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await action();
    toast.success(success);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Replay failed");
    return false;
  }
}

/** Replay ▾: to a destination, to the connected CLI, or edit first. */
export function ReplayMenu({
  requestId,
  actions,
  open,
  onOpenChange,
}: {
  requestId: string;
  actions: ReplayActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const targets = useQuery({
    queryKey: ["replay-targets", requestId],
    queryFn: actions.targets,
    enabled: open || editing,
    staleTime: 10_000,
  });
  const destinations = targets.data?.destinations ?? [];

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" title="Replay (r)">
            <Repeat aria-hidden /> Replay <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Send again</DropdownMenuLabel>
          {targets.isPending && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
          {destinations.map((d) => (
            <DropdownMenuItem
              key={d.id}
              onSelect={() =>
                run(() => actions.toDestination(requestId, d.id), `Replaying to ${d.name}`)
              }
            >
              <Send aria-hidden />
              <span className="truncate">To {d.name}</span>
              {!d.enabled && (
                <span className="text-muted-foreground ml-auto text-xs">disabled</span>
              )}
            </DropdownMenuItem>
          ))}
          {targets.data && destinations.length === 0 && (
            <DropdownMenuItem disabled>No destinations yet</DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={targets.data?.tunnels === 0}
            onSelect={() => run(() => actions.toCli(requestId), "Sent to the connected CLI")}
          >
            <Terminal aria-hidden /> To connected CLI
            {targets.data && (
              <span className="text-muted-foreground ml-auto text-xs">
                {targets.data.tunnels} online
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit & replay…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Edit & replay</SheetTitle>
            <SheetDescription>
              Change the request, then send it. The captured request stays as it was.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <EditForm
              requestId={requestId}
              actions={actions}
              destinations={destinations}
              tunnels={targets.data?.tunnels ?? 0}
              onDone={() => setEditing(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function EditForm({
  requestId,
  actions,
  destinations,
  tunnels,
  onDone,
}: {
  requestId: string;
  actions: ReplayActions;
  destinations: { id: string; name: string }[];
  tunnels: number;
  onDone: () => void;
}) {
  const draft = useQuery({
    queryKey: ["replay-draft", requestId],
    queryFn: () => actions.draft(requestId),
  });
  if (draft.isPending) return <p className="text-muted-foreground p-4 text-sm">Loading…</p>;
  if (draft.error) return <p className="text-destructive p-4 text-sm">{draft.error.message}</p>;
  return (
    <EditFields
      draft={draft.data}
      requestId={requestId}
      actions={actions}
      destinations={destinations}
      tunnels={tunnels}
      onDone={onDone}
    />
  );
}

function EditFields({
  draft,
  requestId,
  actions,
  destinations,
  tunnels,
  onDone,
}: {
  draft: ReplayDraft;
  requestId: string;
  actions: ReplayActions;
  destinations: { id: string; name: string }[];
  tunnels: number;
  onDone: () => void;
}) {
  const [method, setMethod] = useState(draft.method);
  const [path, setPath] = useState(draft.path);
  const [query, setQuery] = useState(draft.query);
  const [headers, setHeaders] = useState(draft.headers);
  const [body, setBody] = useState(draft.body);
  const [target, setTarget] = useState(destinations[0]?.id ?? CLI);
  const [sending, setSending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const edit: ReplayEdit = {
      method,
      path,
      query,
      headers: headers.filter(([k]) => k.trim() !== ""),
      ...(draft.bodyEditable
        ? { body }
        : draft.bodyBase64 !== null
          ? { bodyBase64: draft.bodyBase64 }
          : {}),
    };
    setSending(true);
    const ok = await run(
      () =>
        target === CLI
          ? actions.toCli(requestId, edit)
          : actions.toDestination(requestId, target, edit),
      target === CLI ? "Sent to the connected CLI" : "Replaying the edited request",
    );
    setSending(false);
    if (ok) onDone();
  }

  return (
    <form onSubmit={send} className="grid gap-4 p-4 pt-0">
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <div className="grid gap-2">
          <Label htmlFor="replay-method">Method</Label>
          <Input
            id="replay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value.toUpperCase())}
            className="font-mono"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="replay-path">Path</Label>
          <Input
            id="replay-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="font-mono text-xs"
            required
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="replay-query">Query</Label>
        <Input
          id="replay-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="a=1&b=2"
          className="font-mono text-xs"
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Headers</legend>
        <p className="text-muted-foreground text-xs">
          Masked values are sent as captured unless you change them.
        </p>
        {headers.map(([k, v], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
          <div key={i} className="flex gap-2">
            <Input
              aria-label={`Header name ${i + 1}`}
              value={k}
              className="font-mono text-xs"
              onChange={(e) =>
                setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))
              }
            />
            <Input
              aria-label={`Header value ${i + 1}`}
              value={v}
              className="font-mono text-xs"
              onChange={(e) =>
                setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove header ${i + 1}`}
              onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setHeaders([...headers, ["", ""]])}
        >
          <Plus aria-hidden /> Add header
        </Button>
      </fieldset>
      <div className="grid gap-2">
        <Label htmlFor="replay-body">Body</Label>
        {draft.bodyEditable ? (
          <Textarea
            id="replay-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="font-mono text-xs"
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {draft.bodyBase64 !== null
              ? "Binary body: sent unchanged."
              : "The body is too large to edit here. Replay without editing to send it."}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="replay-target">Send to</Label>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger id="replay-target" aria-label="Send to">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {destinations.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
            <SelectItem value={CLI}>Connected CLI ({tunnels} online)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="submit"
        disabled={sending || (!draft.bodyEditable && draft.bodyBase64 === null)}
      >
        <Send aria-hidden /> Send
      </Button>
    </form>
  );
}
