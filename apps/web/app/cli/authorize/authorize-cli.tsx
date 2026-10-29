"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Terminal } from "lucide-react";
import { useState } from "react";
import { AuthHeading, FormMessage, SubmitButton } from "@/components/auth/form-bits";
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
import { useTRPC } from "@/lib/trpc/client";

const SCOPE_LABELS: Record<string, string> = {
  "endpoints:read": "List and view endpoints",
  "endpoints:write": "Create, change and delete endpoints",
  "requests:read": "Read captured requests",
  "requests:replay": "Replay requests",
  tunnel: "Open tunnels to your machine",
  "destinations:write": "Manage destinations",
};

export function AuthorizeCli({ initialCode }: { initialCode: string }) {
  const trpc = useTRPC();
  const [draft, setDraft] = useState(initialCode);
  const [code, setCode] = useState(initialCode);
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  const lookup = useQuery({
    ...trpc.cli.lookup.queryOptions({ code }),
    enabled: code.replace(/[^A-Za-z]/g, "").length === 8,
    retry: false,
  });
  const approve = useMutation(trpc.cli.approve.mutationOptions());
  const deny = useMutation(trpc.cli.deny.mutationOptions());
  const orgs = lookup.data?.orgs ?? [];
  const selected = orgSlug || orgs[0]?.slug || "";

  if (done) {
    const Icon = done === "approved" ? CircleCheck : CircleX;
    return (
      <div className="grid justify-items-center gap-3 text-center">
        <Icon
          className={
            done === "approved"
              ? "size-10 text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground size-10"
          }
          aria-hidden
        />
        <h1 className="text-2xl font-semibold tracking-tight">
          {done === "approved" ? "CLI authorized" : "Login denied"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {done === "approved"
            ? "Return to your terminal; it is signed in now. You can close this tab."
            : "The CLI was not signed in. You can close this tab."}
        </p>
      </div>
    );
  }

  if (!lookup.data) {
    return (
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft === code) void lookup.refetch();
          else setCode(draft);
        }}
      >
        <AuthHeading title="Authorize the CLI">
          Enter the code shown by <code className="font-mono">hookline login</code>.
        </AuthHeading>
        <div className="grid gap-2">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-widest uppercase"
            maxLength={16}
            required
          />
        </div>
        <FormMessage error={lookup.error?.message ?? null} />
        <SubmitButton pending={lookup.isFetching}>Continue</SubmitButton>
      </form>
    );
  }

  const data = lookup.data;
  return (
    <div className="grid gap-6">
      <AuthHeading title="Authorize the CLI">
        A terminal
        {data.clientName ? (
          <>
            {" "}
            on <strong>{data.clientName}</strong>
          </>
        ) : null}{" "}
        is asking to sign in to Hookline. Only approve it if you just ran{" "}
        <code className="font-mono">hookline login</code> and the code matches.
      </AuthHeading>

      <div className="bg-muted flex items-center justify-center gap-3 rounded-lg py-4">
        <Terminal className="text-muted-foreground size-5" aria-hidden />
        <span data-testid="device-code" className="font-mono text-2xl tracking-[0.3em]">
          {code
            .toUpperCase()
            .replace(/[^A-Z]/g, "")
            .replace(/^(.{4})/, "$1-")}
        </span>
      </div>

      {orgs.length === 0 ? (
        <p className="text-sm">You need the member role in an organization to authorize the CLI.</p>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="org">Organization</Label>
          <Select value={selected} onValueChange={setOrgSlug}>
            <SelectTrigger id="org" aria-label="Organization">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.slug} value={o.slug}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            The CLI gets an API key for this organization. You can revoke it any time.
          </p>
        </div>
      )}

      <div className="grid gap-2">
        <span className="text-sm font-medium">It will be able to</span>
        <ul className="text-muted-foreground grid gap-1 text-sm">
          {data.scopes.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <CircleCheck
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              {SCOPE_LABELS[s] ?? s}
            </li>
          ))}
        </ul>
      </div>

      <FormMessage error={approve.error?.message ?? deny.error?.message ?? null} />
      <div className="flex gap-3">
        <Button
          className="flex-1"
          disabled={!selected || approve.isPending || deny.isPending}
          onClick={async () => {
            if (await attempt(approve.mutateAsync({ code, orgSlug: selected })))
              setDone("approved");
          }}
        >
          Approve
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={approve.isPending || deny.isPending}
          onClick={async () => {
            if (await attempt(deny.mutateAsync({ code }))) setDone("denied");
          }}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}
