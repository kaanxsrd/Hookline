"use client";

import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type BodyKind,
  bodyText,
  decodeBase64,
  detectKind,
  formatBytes,
  hexDump,
  parseForm,
  prettyXml,
} from "@/lib/body";
import { cn } from "@/lib/utils";
import { JsonTree } from "./json-tree";
import type { RequestDetail } from "./types";

type View = "pretty" | "raw" | "hex";

/** Shows a body as a JSON tree, form fields, indented XML, raw text or hex. Never as HTML. */
export function BodyViewer({
  detail,
  downloadUrl,
}: {
  detail: RequestDetail;
  downloadUrl: string;
}) {
  const bytes = useMemo(
    () => (detail.body ? decodeBase64(detail.body.base64) : new Uint8Array()),
    [detail.body],
  );
  const kind: BodyKind = useMemo(
    () => detectKind(bytes, detail.content_type),
    [bytes, detail.content_type],
  );
  const text = useMemo(
    () => (kind === "binary" || kind === "empty" ? null : bodyText(bytes)),
    [bytes, kind],
  );
  const hasPretty = kind === "json" || kind === "form" || kind === "xml";
  const [view, setView] = useState<View>(hasPretty ? "pretty" : kind === "binary" ? "hex" : "raw");

  if (!detail.body || detail.body_size === 0) {
    return <p className="text-muted-foreground text-sm">No body.</p>;
  }

  const views: { id: View; label: string }[] = [
    ...(hasPretty
      ? [
          {
            id: "pretty" as const,
            label: kind === "json" ? "JSON" : kind === "form" ? "Form" : "XML",
          },
        ]
      : []),
    ...(text !== null ? [{ id: "raw" as const, label: "Raw" }] : []),
    { id: "hex", label: "Hex" },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Body view"
          className="bg-muted inline-flex rounded-md p-0.5"
        >
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                view === v.id
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          {formatBytes(detail.body_size)}
          {detail.content_type && <span className="font-mono">{detail.content_type}</span>}
          <Button variant="outline" size="sm" asChild>
            <a href={downloadUrl} download>
              <Download aria-hidden /> Download
            </a>
          </Button>
        </span>
      </div>

      {detail.body.truncated && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Showing the first {formatBytes(bytes.length)} of {formatBytes(detail.body_size)}
          {detail.body.in_storage ? " (stored in object storage)" : ""}. Download for the full body.
        </p>
      )}

      <div className="bg-background max-h-[60vh] overflow-auto rounded-md border p-3">
        {view === "pretty" && kind === "json" && text !== null && <JsonView text={text} />}
        {view === "pretty" && kind === "form" && text !== null && <FormView text={text} />}
        {view === "pretty" && kind === "xml" && text !== null && (
          <pre className="font-mono text-xs whitespace-pre-wrap">{prettyXml(text)}</pre>
        )}
        {view === "raw" && text !== null && (
          <pre className="font-mono text-xs break-all whitespace-pre-wrap">{text}</pre>
        )}
        {view === "hex" && <HexView bytes={bytes} />}
      </div>
    </div>
  );
}

function JsonView({ text }: { text: string }) {
  const value = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) };
    } catch {
      return { ok: false as const };
    }
  }, [text]);
  if (!value.ok) return <pre className="font-mono text-xs whitespace-pre-wrap">{text}</pre>;
  return <JsonTree value={value.value} />;
}

function FormView({ text }: { text: string }) {
  const fields = parseForm(text);
  return (
    <table className="w-full table-fixed font-mono text-xs">
      <tbody>
        {fields.map(([name, value], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fields repeat and never reorder
          <tr key={i} className="align-top">
            <th
              scope="row"
              className="text-muted-foreground w-1/3 truncate py-0.5 pr-4 text-left font-normal"
            >
              {name}
            </th>
            <td className="py-0.5 break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HexView({ bytes }: { bytes: Uint8Array }) {
  const { text, truncated } = hexDump(bytes);
  return (
    <>
      <pre className="font-mono text-xs">{text}</pre>
      {truncated && <p className="text-muted-foreground mt-2 text-xs">Showing the first 4 KB.</p>}
    </>
  );
}
