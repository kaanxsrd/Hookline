"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { initials } from "@/components/app-shell/user-menu";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt } from "@/lib/attempt";
import { hasRole, type Role } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc/client";

const ROLE_HELP: Record<Role, string> = {
  viewer: "Reads endpoints and requests",
  member: "Creates endpoints, replays, forwards",
  admin: "Also manages members, keys and settings",
  owner: "Full control, including billing and deletion",
};

export function MembersSettings({ orgSlug }: { orgSlug: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const list = useQuery(trpc.member.list.queryOptions({ orgSlug }));
  const refresh = () => queryClient.invalidateQueries(trpc.member.list.queryFilter({ orgSlug }));
  const onError = (e: { message: string }) => toast.error(e.message);

  const invite = useMutation(trpc.member.invite.mutationOptions({ onSuccess: refresh }));
  const cancel = useMutation(
    trpc.member.cancelInvitation.mutationOptions({ onSuccess: refresh, onError }),
  );
  const updateRole = useMutation(
    trpc.member.updateRole.mutationOptions({ onSuccess: refresh, onError }),
  );
  const remove = useMutation(trpc.member.remove.mutationOptions({ onSuccess: refresh, onError }));
  const [inviteRole, setInviteRole] = useState<"viewer" | "member" | "admin">("member");

  if (!list.data) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const { members, invitations, you } = list.data;
  const isAdmin = hasRole(you.role, "admin");

  return (
    <div className="grid gap-10">
      {isAdmin && (
        <section className="grid gap-3">
          <h2 className="font-medium">Invite someone</h2>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
            action={async (form) => {
              const sent = await attempt(
                invite.mutateAsync({ orgSlug, email: String(form.get("email")), role: inviteRole }),
              );
              if (sent) toast.success("Invitation sent");
            }}
          >
            <Field label="Email" id="email" type="email" required autoComplete="off" />
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as typeof inviteRole)}
              >
                <SelectTrigger id="invite-role" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["viewer", "member", "admin"] as const).map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SubmitButton pending={invite.isPending}>Send invitation</SubmitButton>
          </form>
          <p className="text-muted-foreground text-xs">{ROLE_HELP[inviteRole]}.</p>
          <FormMessage error={invite.error?.message ?? null} />
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="font-medium">Members ({members.length})</h2>
        <ul className="divide-y rounded-lg border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {m.name}{" "}
                  {m.id === you.memberId && <span className="text-muted-foreground">(you)</span>}
                </span>
                <span className="text-muted-foreground block truncate text-xs">{m.email}</span>
              </span>
              {isAdmin && m.id !== you.memberId ? (
                <>
                  <Select
                    value={m.role}
                    onValueChange={(role) =>
                      updateRole.mutate({ orgSlug, memberId: m.id, role: role as Role })
                    }
                  >
                    <SelectTrigger className="w-28" aria-label={`Role of ${m.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["viewer", "member", "admin", "owner"] as const)
                        .filter((r) => r !== "owner" || you.role === "owner")
                        .map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${m.name} from the organization?`)) {
                        remove.mutate({ orgSlug, memberId: m.id });
                      }
                    }}
                  >
                    <UserMinus aria-hidden />
                  </Button>
                </>
              ) : (
                <Badge variant="secondary" className="capitalize">
                  {m.role}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && invitations.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-medium">Pending invitations</h2>
          <ul className="divide-y rounded-lg border">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <Badge variant="outline" className="capitalize">
                  {i.role}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Cancel the invitation for ${i.email}`}
                  onClick={() => cancel.mutate({ orgSlug, invitationId: i.id })}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
