"use client";

import { useMutation } from "@tanstack/react-query";
import { useAdminAction } from "@/components/admin/admin-bits";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/lib/trpc/client";

type Props = {
  user: {
    id: string;
    name: string;
    isAdmin: boolean;
    disabled: boolean;
    isYou: boolean;
    apiKeys: number;
  };
};

export function UserActions({ user }: Props) {
  const trpc = useTRPC();
  const disable = useMutation(trpc.admin.users.disable.mutationOptions());
  const enable = useMutation(trpc.admin.users.enable.mutationOptions());
  const grant = useMutation(trpc.admin.users.grantAdmin.mutationOptions());
  const revoke = useMutation(trpc.admin.users.revokeAdmin.mutationOptions());
  const { run, pending } = useAdminAction();

  if (user.isYou) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        This is your account. Another administrator has to disable it or remove your access.
      </p>
    );
  }

  return (
    <section className="bg-card grid gap-3 rounded-lg border p-4" aria-labelledby="actions">
      <h2 id="actions" className="font-medium">
        Actions
      </h2>

      {user.disabled ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => enable.mutateAsync({ id: user.id }), `${user.name} can sign in again`)
          }
        >
          Enable account
        </Button>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={pending}>
              Disable account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disable {user.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                They are signed out everywhere and cannot sign in again until you enable the
                account.{" "}
                {user.apiKeys > 0
                  ? `Their ${user.apiKeys} API ${user.apiKeys === 1 ? "key" : "keys"} (including CLI logins) will be revoked for good.`
                  : "API keys they created are revoked too."}{" "}
                Their organizations and endpoints keep working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  run(() => disable.mutateAsync({ id: user.id }), `${user.name} is disabled`)
                }
              >
                Disable
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {user.isAdmin ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => revoke.mutateAsync({ id: user.id }),
              `${user.name} is no longer an administrator`,
            )
          }
        >
          Remove administrator access
        </Button>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={pending}>
              Make administrator
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Make {user.name} an administrator?</AlertDialogTitle>
              <AlertDialogDescription>
                Administrators can see every account, organization and endpoint on this instance,
                disable them and change plans.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  run(
                    () => grant.mutateAsync({ id: user.id }),
                    `${user.name} is now an administrator`,
                  )
                }
              >
                Make administrator
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}
