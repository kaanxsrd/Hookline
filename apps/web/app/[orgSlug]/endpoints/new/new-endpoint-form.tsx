"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const TEMPLATES = [
  { value: "generic", label: "Generic", hint: "Answers 200 with an empty body." },
  { value: "stripe", label: "Stripe", hint: 'Answers 200 with {"received":true}.' },
  { value: "github", label: "GitHub", hint: "Answers 202 Accepted." },
  { value: "shopify", label: "Shopify", hint: "Answers 200." },
  { value: "discord", label: "Discord", hint: 'Answers PING with PONG ({"type":1}).' },
] as const;

type Template = (typeof TEMPLATES)[number]["value"];

export function NewEndpointForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const [template, setTemplate] = useState<Template>("generic");
  const create = useMutation(trpc.endpoint.create.mutationOptions());

  async function onSubmit(form: FormData) {
    const created = await attempt(
      create.mutateAsync({
        orgSlug,
        name: String(form.get("name")),
        description: String(form.get("description") ?? ""),
        template,
      }),
    );
    if (!created) return;
    router.push(`/${orgSlug}/endpoints/${created.slug}`);
  }

  return (
    <form action={onSubmit} className="grid max-w-xl gap-6">
      <Field label="Name" id="name" required maxLength={80} placeholder="Stripe (staging)" />
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          maxLength={500}
          rows={2}
          placeholder="Optional"
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Template</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <label
              key={t.value}
              className={cn(
                "hover:bg-accent/50 flex cursor-pointer flex-col rounded-lg border p-3 text-sm",
                template === t.value && "border-primary ring-primary/30 ring-2",
              )}
            >
              <input
                type="radio"
                name="template"
                value={t.value}
                checked={template === t.value}
                onChange={() => setTemplate(t.value)}
                className="sr-only"
              />
              <span className="font-medium">{t.label}</span>
              <span className="text-muted-foreground text-xs">{t.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage error={create.error?.message ?? null} />
      <SubmitButton pending={create.isPending} className="justify-self-start">
        Create endpoint
      </SubmitButton>
    </form>
  );
}
