"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { attempt } from "@/lib/attempt";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validOrgSlug } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc/client";

type Props = {
  userName: string;
  /** Host of APP_URL, shown in the organization URL preview. */
  appHost: string;
  existingOrgs: { slug: string; name: string }[];
  /** A temporary endpoint this browser created and can keep. */
  temporarySlug: string | null;
};

type Step = "org" | "endpoint" | "done";

const TEMPLATES = [
  { value: "generic", label: "Generic" },
  { value: "stripe", label: "Stripe" },
  { value: "github", label: "GitHub" },
  { value: "shopify", label: "Shopify" },
  { value: "discord", label: "Discord" },
] as const;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function OnboardingWizard({ userName, appHost, existingOrgs, temporarySlug }: Props) {
  const trpc = useTRPC();
  const [step, setStep] = useState<Step>(existingOrgs.length > 0 ? "endpoint" : "org");
  const [org, setOrg] = useState<{ slug: string; name: string } | null>(existingOrgs[0] ?? null);
  const [endpoint, setEndpoint] = useState<{ slug: string; url: string } | null>(null);

  const createEndpoint = useMutation(trpc.endpoint.create.mutationOptions());
  const claim = useMutation(trpc.endpoint.claimAnonymous.mutationOptions());

  return (
    <div className="grid gap-8">
      <ol className="text-muted-foreground flex gap-4 text-sm" aria-label="Progress">
        {(["org", "endpoint", "done"] as const).map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? "step" : undefined}
            className={step === s ? "text-foreground font-medium" : ""}
          >
            {i + 1}. {s === "org" ? "Organization" : s === "endpoint" ? "Endpoint" : "Connect"}
          </li>
        ))}
      </ol>

      {step === "org" && (
        <OrgStep
          userName={userName}
          appHost={appHost}
          onCreated={(created) => {
            setOrg(created);
            setStep("endpoint");
          }}
        />
      )}

      {step === "endpoint" && org && (
        <section className="grid gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Your first endpoint</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              An endpoint is a URL that captures every request sent to it.
            </p>
          </div>

          {temporarySlug && (
            <div className="bg-card grid gap-3 rounded-lg border p-4">
              <p className="text-sm">
                Keep the temporary endpoint you created, with every request it captured, in{" "}
                <strong>{org.name}</strong>.
              </p>
              <FormMessage error={claim.error?.message ?? null} />
              <Button
                disabled={claim.isPending}
                onClick={async () => {
                  const claimed = await attempt(claim.mutateAsync({ orgSlug: org.slug }));
                  if (claimed) window.location.href = `/${org.slug}/endpoints/${claimed.slug}`;
                }}
              >
                Keep my temporary endpoint
              </Button>
            </div>
          )}

          <form
            className="grid gap-4"
            action={async (form) => {
              const created = await attempt(
                createEndpoint.mutateAsync({
                  orgSlug: org.slug,
                  name: String(form.get("name")),
                  template: String(form.get("template")) as (typeof TEMPLATES)[number]["value"],
                }),
              );
              if (!created) return;
              setEndpoint({ slug: created.slug, url: created.url });
              setStep("done");
            }}
          >
            <Field
              label="Name"
              id="name"
              defaultValue="My first endpoint"
              required
              maxLength={80}
            />
            <div className="grid gap-2">
              <Label htmlFor="template">Sending from</Label>
              <Select name="template" defaultValue="generic">
                <SelectTrigger id="template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Sets a response the provider expects. You can change it later.
              </p>
            </div>
            <FormMessage error={createEndpoint.error?.message ?? null} />
            <SubmitButton
              pending={createEndpoint.isPending}
              variant={temporarySlug ? "outline" : "default"}
            >
              Create endpoint
            </SubmitButton>
          </form>
        </section>
      )}

      {step === "done" && org && endpoint && (
        <section className="grid gap-6">
          <div>
            <Check className="mb-3 size-8 text-emerald-500" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">You're ready</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Point a webhook at this URL, or send a test request.
            </p>
          </div>
          <div className="bg-card flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
            <code data-testid="endpoint-url" className="min-w-0 flex-1 truncate font-mono text-sm">
              {endpoint.url}
            </code>
            <CopyButton value={endpoint.url} label="Copy endpoint URL" />
          </div>
          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Terminal className="size-4" aria-hidden /> Pipe it to localhost with the CLI
            </p>
            <pre className="bg-card overflow-x-auto rounded-lg border p-3 font-mono text-xs">
              {`npm install -g hookline\nhookline login\nhookline listen ${endpoint.slug} --forward http://localhost:3000/api/webhooks`}
            </pre>
          </div>
          <Button asChild>
            <Link href={`/${org.slug}/endpoints/${endpoint.slug}`}>Open the inbox</Link>
          </Button>
        </section>
      )}
    </div>
  );
}

function OrgStep({
  userName,
  appHost,
  onCreated,
}: {
  userName: string;
  appHost: string;
  onCreated: (org: { slug: string; name: string }) => void;
}) {
  const suggested = `${userName.split(" ")[0] ?? "My"}'s team`;
  const [name, setName] = useState(suggested);
  const [slug, setSlug] = useState(slugify(suggested));
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    if (!validOrgSlug(slug)) {
      setError("Use 3–40 lowercase letters, numbers and dashes for the URL.");
      return;
    }
    setPending(true);
    setError(null);
    const { data, error } = await authClient.organization.create({ name, slug });
    setPending(false);
    if (error || !data) setError(authErrorMessage(error));
    else onCreated({ slug: data.slug, name: data.name });
  }

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your organization</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Endpoints, members and billing belong to an organization. You can invite your team later.
        </p>
      </div>
      <form action={onSubmit} className="grid gap-4">
        <Field
          label="Name"
          id="org-name"
          value={name}
          required
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
        <Field
          label="URL"
          id="org-slug"
          value={slug}
          required
          maxLength={40}
          hint={`${appHost}/${slug || "your-team"}`}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
        <FormMessage error={error} />
        <SubmitButton pending={pending}>Continue</SubmitButton>
      </form>
    </section>
  );
}
