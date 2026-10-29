"use client";

import { limitsFor } from "@hookline/shared";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useAdminAction } from "@/components/admin/admin-bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTRPC } from "@/lib/trpc/client";

type Choice = "none" | "free" | "pro" | "team";

/** Assigns a plan that wins over the subscription (subscription.plan_override). */
export function PlanForm({
  orgId,
  orgName,
  planOverride,
  subscribedPlan,
  billingEnabled,
  instanceOverride,
}: {
  orgId: string;
  orgName: string;
  planOverride: "free" | "pro" | "team" | null;
  subscribedPlan: "free" | "pro" | "team";
  billingEnabled: boolean;
  instanceOverride: string | null;
}) {
  const id = useId();
  const trpc = useTRPC();
  const setPlan = useMutation(trpc.admin.orgs.setPlan.mutationOptions());
  const { run, pending } = useAdminAction();
  const [choice, setChoice] = useState<Choice>(planOverride ?? "none");
  const current: Choice = planOverride ?? "none";

  return (
    <section className="bg-card grid gap-3 rounded-lg border p-4" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="font-medium">
        Plan
      </h2>
      <p className="text-muted-foreground text-sm">
        {billingEnabled
          ? `Billing says ${limitsFor(subscribedPlan).name}. An assigned plan wins over the subscription until you remove it.`
          : "Billing is off on this instance, so plans are assigned here."}
      </p>
      {instanceOverride && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          PLAN_OVERRIDE={instanceOverride} applies to every organization, whatever is assigned here.
        </p>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-plan`}>Assigned plan</Label>
        <Select value={choice} onValueChange={(v) => setChoice(v as Choice)}>
          <SelectTrigger id={`${id}-plan`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              None ({limitsFor(subscribedPlan).name}
              {billingEnabled ? ", from billing" : ""})
            </SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="team">Team</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        disabled={pending || choice === current}
        onClick={() =>
          run(
            () => setPlan.mutateAsync({ id: orgId, plan: choice === "none" ? null : choice }),
            `Plan updated for ${orgName}`,
          )
        }
      >
        Save plan
      </Button>
      <p className="text-muted-foreground text-xs">
        A change applies at once: retention is capped to the new plan and owners and admins are
        emailed.
      </p>
    </section>
  );
}
