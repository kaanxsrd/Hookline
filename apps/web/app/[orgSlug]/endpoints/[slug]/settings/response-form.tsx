"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { attempt } from "@/lib/attempt";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  410: "Gone",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export type ResponseSettings = {
  mode: "static" | "cli_sync";
  status: number;
  headers: [string, string][];
  body: string;
  delayMs: number;
  syncTimeoutMs: number;
};

/** Mode, status, headers, body and delay of the answer senders get. */
export function ResponseForm({
  orgSlug,
  slug,
  canEdit,
  initial,
}: {
  orgSlug: string;
  slug: string;
  canEdit: boolean;
  initial: ResponseSettings;
}) {
  const id = useId();
  const router = useRouter();
  const trpc = useTRPC();
  const save = useMutation(trpc.endpoint.updateResponse.mutationOptions());
  const [mode, setMode] = useState(initial.mode);
  const [status, setStatus] = useState(String(initial.status));
  const [headers, setHeaders] = useState(initial.headers);
  const [body, setBody] = useState(initial.body);
  const [delay, setDelay] = useState(String(initial.delayMs));
  const [timeout, setTimeoutSec] = useState(String(initial.syncTimeoutMs / 1000));

  const code = Number(status);
  const filled = headers.filter(([k]) => k.trim() !== "");
  const contentType = filled.some(([k]) => k.toLowerCase() === "content-type");
  const preview = [
    `HTTP/1.1 ${status} ${STATUS_TEXT[code] ?? ""}`.trimEnd(),
    ...filled.map(([k, v]) => `${k}: ${v}`),
    ...(body && !contentType ? ["Content-Type: text/plain; charset=utf-8"] : []),
    "",
    code === 204 || code === 304 ? "" : body,
  ].join("\n");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await attempt(
      save.mutateAsync({
        orgSlug,
        slug,
        mode,
        status: code,
        headers: filled,
        body,
        delayMs: Number(delay),
        syncTimeoutMs: Math.round(Number(timeout) * 1000),
      }),
    );
    if (!ok) return;
    toast.success("Response saved");
    router.refresh();
  }

  return (
    <section className="grid gap-4" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="font-medium">
          Response
        </h2>
        <p className="text-muted-foreground text-sm">
          What senders receive when a request is captured.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-5">
        <fieldset className="grid gap-2 sm:grid-cols-2" disabled={!canEdit}>
          <legend className="sr-only">Response mode</legend>
          {(
            [
              ["static", "Static response", "Always answer with the response below."],
              [
                "cli_sync",
                "CLI sync",
                "Answer with what your local server returns through `hookline listen --sync`, falling back to the response below.",
              ],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className={cn(
                "has-[:focus-visible]:ring-ring/50 grid cursor-pointer gap-1 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-[3px]",
                mode === value && "border-primary bg-primary/5",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="accent-primary"
                />
                {title}
              </span>
              <span className="text-muted-foreground text-xs">{text}</span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-status`}>Status</Label>
            <Input
              id={`${id}-status`}
              type="number"
              min={200}
              max={599}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              required
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-delay`}>Delay (ms)</Label>
            <Input
              id={`${id}-delay`}
              type="number"
              min={0}
              max={30000}
              step={100}
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          {mode === "cli_sync" && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-timeout`}>CLI timeout (s)</Label>
              <Input
                id={`${id}-timeout`}
                type="number"
                min={1}
                max={30}
                value={timeout}
                onChange={(e) => setTimeoutSec(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          )}
        </div>

        <fieldset className="grid gap-2" disabled={!canEdit}>
          <legend className="mb-1 text-sm font-medium">Headers</legend>
          {headers.map(([k, v], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Response header name ${i + 1}`}
                value={k}
                placeholder="Content-Type"
                className="font-mono text-xs"
                onChange={(e) =>
                  setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))
                }
              />
              <Input
                aria-label={`Response header value ${i + 1}`}
                value={v}
                placeholder="application/json"
                className="font-mono text-xs"
                onChange={(e) =>
                  setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove response header ${i + 1}`}
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
            disabled={headers.length >= 20}
            onClick={() => setHeaders([...headers, ["", ""]])}
          >
            <Plus aria-hidden /> Add response header
          </Button>
          <p className="text-muted-foreground text-xs">
            CORS, cookies, caching and security headers are set by Hookline and cannot be
            overridden.
          </p>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor={`${id}-body`}>Body</Label>
          <Textarea
            id={`${id}-body`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="font-mono text-xs"
            maxLength={64 * 1024}
            disabled={!canEdit}
          />
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Preview</span>
          <pre
            data-testid="response-preview"
            className="bg-muted/50 max-h-48 overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap"
          >
            {preview}
          </pre>
        </div>

        <FormMessage error={save.error?.message ?? null} />
        {canEdit && (
          <SubmitButton pending={save.isPending} className="justify-self-start">
            Save response
          </SubmitButton>
        )}
      </form>
    </section>
  );
}
