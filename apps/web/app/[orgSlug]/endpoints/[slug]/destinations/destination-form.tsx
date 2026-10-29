"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type DestinationValues = {
  name: string;
  url: string;
  enabled: boolean;
  filter: {
    methods?: string[];
    header_equals?: Record<string, string>;
    json_path_equals?: Record<string, string | number | boolean | null>;
  };
  extraHeaders: [string, string][];
  timeoutMs: number;
  maxAttempts: number;
  signWithStandardWebhooks: boolean;
};

export const EMPTY_DESTINATION: DestinationValues = {
  name: "",
  url: "",
  enabled: true,
  filter: {},
  extraHeaders: [],
  timeoutMs: 10_000,
  maxAttempts: 8,
  signWithStandardWebhooks: false,
};

type Row = { key: string; value: string };

const toRows = (r: Record<string, unknown> | undefined): Row[] =>
  Object.entries(r ?? {}).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));

/** JSON-path values: true/false/null/numbers are typed; anything else is a string. */
function parseScalar(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return raw;
}

function RowsEditor({
  label,
  hint,
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  disabled,
}: {
  label: string;
  hint: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  disabled: boolean;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <p className="text-muted-foreground text-xs">{hint}</p>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`${label} name ${i + 1}`}
            placeholder={keyPlaceholder}
            value={row.key}
            disabled={disabled}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
            }
            className="font-mono text-xs"
          />
          <Input
            aria-label={`${label} value ${i + 1}`}
            placeholder={valuePlaceholder}
            value={row.value}
            disabled={disabled}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
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
        disabled={disabled || rows.length >= 20}
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Plus aria-hidden /> {addLabel}
      </Button>
    </fieldset>
  );
}

/** Create/edit form for a destination. */
export function DestinationForm({
  initial,
  submitLabel,
  pending,
  error,
  disabled = false,
  onSubmit,
}: {
  initial: DestinationValues;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  disabled?: boolean;
  onSubmit: (values: DestinationValues) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.url);
  const [methods, setMethods] = useState<string[]>(initial.filter.methods ?? []);
  const [headerRows, setHeaderRows] = useState<Row[]>(toRows(initial.filter.header_equals));
  const [jsonRows, setJsonRows] = useState<Row[]>(toRows(initial.filter.json_path_equals));
  const [extraRows, setExtraRows] = useState<Row[]>(
    initial.extraHeaders.map(([key, value]) => ({ key, value })),
  );
  const [timeoutSec, setTimeoutSec] = useState(String(initial.timeoutMs / 1000));
  const [maxAttempts, setMaxAttempts] = useState(String(initial.maxAttempts));
  const [sign, setSign] = useState(initial.signWithStandardWebhooks);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const filled = (rows: Row[]) => rows.filter((r) => r.key.trim() !== "");
    onSubmit({
      name: name.trim(),
      url: url.trim(),
      enabled: initial.enabled,
      filter: {
        ...(methods.length ? { methods } : {}),
        ...(filled(headerRows).length
          ? {
              header_equals: Object.fromEntries(
                filled(headerRows).map((r) => [r.key.trim(), r.value]),
              ),
            }
          : {}),
        ...(filled(jsonRows).length
          ? {
              json_path_equals: Object.fromEntries(
                filled(jsonRows).map((r) => [r.key.trim(), parseScalar(r.value)]),
              ),
            }
          : {}),
      },
      extraHeaders: filled(extraRows).map((r) => [r.key.trim(), r.value] as [string, string]),
      timeoutMs: Math.round(Number(timeoutSec) * 1000),
      maxAttempts: Number(maxAttempts),
      signWithStandardWebhooks: sign,
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="Staging API"
            disabled={disabled}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-url`}>URL</Label>
          <Input
            id={`${id}-url`}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            maxLength={2048}
            placeholder="https://api.example.com/webhooks"
            className="font-mono text-xs"
            disabled={disabled}
          />
        </div>
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Filters</legend>
        <p className="text-muted-foreground -mt-2 text-xs">
          Only requests matching every condition are forwarded. Leave empty to forward everything.
        </p>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Methods</span>
          <div className="flex flex-wrap gap-4">
            {METHODS.map((m) => (
              <Label key={m} className="flex items-center gap-2 font-mono text-xs font-normal">
                <Checkbox
                  checked={methods.includes(m)}
                  disabled={disabled}
                  onCheckedChange={(v) =>
                    setMethods((prev) => (v ? [...prev, m] : prev.filter((x) => x !== m)))
                  }
                />
                {m}
              </Label>
            ))}
          </div>
        </div>
        <RowsEditor
          label="Header equals"
          hint="Header name (any case) and its exact value."
          rows={headerRows}
          onChange={setHeaderRows}
          keyPlaceholder="X-GitHub-Event"
          valuePlaceholder="push"
          addLabel="Add header condition"
          disabled={disabled}
        />
        <RowsEditor
          label="JSON body equals"
          hint="A path into the JSON body and the value it must hold. true, false, null and numbers are typed."
          rows={jsonRows}
          onChange={setJsonRows}
          keyPlaceholder="data.object.status"
          valuePlaceholder="succeeded"
          addLabel="Add body condition"
          disabled={disabled}
        />
      </fieldset>

      <RowsEditor
        label="Extra headers"
        hint="Added to every forwarded request, e.g. an Authorization header your API expects."
        rows={extraRows}
        onChange={setExtraRows}
        keyPlaceholder="Authorization"
        valuePlaceholder="Bearer …"
        addLabel="Add header"
        disabled={disabled}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-timeout`}>Timeout (seconds)</Label>
          <Input
            id={`${id}-timeout`}
            type="number"
            min={1}
            max={30}
            step={1}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
            required
            disabled={disabled}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-attempts`}>Attempts</Label>
          <Input
            id={`${id}-attempts`}
            type="number"
            min={1}
            max={20}
            step={1}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            required
            disabled={disabled}
          />
          <p className="text-muted-foreground text-xs">
            Timeouts, 408, 429 and 5xx are retried with exponential backoff (up to 6 hours apart).
          </p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-sign`}>Sign with Standard Webhooks</Label>
          <p className="text-muted-foreground text-xs">
            Adds webhook-id, webhook-timestamp and webhook-signature headers so your API can verify
            the request came from Hookline.
          </p>
        </div>
        <Switch id={`${id}-sign`} checked={sign} onCheckedChange={setSign} disabled={disabled} />
      </div>

      <FormMessage error={error} />
      {!disabled && (
        <SubmitButton pending={pending} className="justify-self-start">
          {submitLabel}
        </SubmitButton>
      )}
    </form>
  );
}
