"use client";

import { MASKED_VALUE } from "@hookline/shared";
import { ChevronDown, Copy, Download, Eye, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bodyText, decodeBase64, formatBytes } from "@/lib/body";
import { type CopyableRequest, toCurl, toFetch, toHttpie } from "@/lib/copy-as";
import { SignatureBadge, StatusCode } from "./badges";
import { BodyViewer } from "./body-viewer";
import { DeliveriesTimeline } from "./deliveries-timeline";
import { MethodChip } from "./method-chip";
import { RelativeTime } from "./relative-time";
import type { RequestDetail as Detail } from "./types";

export type DetailTab = "body" | "headers" | "query" | "deliveries" | "meta";

type Props = {
  detail: Detail;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  downloadUrl: string;
  /** Absolute link to this request, for sharing (members only). */
  permalink?: string | undefined;
  canReveal: boolean;
  onReveal: () => Promise<void>;
  onDelete?: (() => Promise<void>) | undefined;
  onRetryDelivery?: ((deliveryId: string) => Promise<void>) | undefined;
};

export function copyable(detail: Detail): CopyableRequest {
  const bytes = detail.body && !detail.body.truncated ? decodeBase64(detail.body.base64) : null;
  return {
    method: detail.method,
    url: detail.url,
    headers: detail.headers,
    bodyText: bytes ? bodyText(bytes) : null,
    hasBody: detail.body_size > 0,
  };
}

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

export function RequestDetail({
  detail,
  tab,
  onTabChange,
  downloadUrl,
  permalink,
  canReveal,
  onReveal,
  onDelete,
  onRetryDelivery,
}: Props) {
  const [revealing, setRevealing] = useState(false);

  const copyAs = async (format: "cURL" | "fetch" | "HTTPie") => {
    const req = copyable(detail);
    const code =
      format === "cURL" ? toCurl(req) : format === "fetch" ? toFetch(req) : toHttpie(req);
    await copyText(code, `as ${format}`);
    if (detail.headers_masked)
      toast.info("Sensitive headers are masked; reveal them to include their values.");
  };

  async function reveal() {
    setRevealing(true);
    try {
      await onReveal();
    } finally {
      setRevealing(false);
    }
  }

  return (
    <article aria-label="Request detail" className="flex h-full min-h-0 flex-col">
      <header className="grid gap-3 border-b p-4">
        <div className="flex min-w-0 items-center gap-2">
          <MethodChip method={detail.method} />
          <h2 className="min-w-0 truncate font-mono text-sm">{detail.path}</h2>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <RelativeTime iso={detail.received_at} />
          <span>
            Responded <StatusCode code={detail.response_status} />
          </span>
          <span>{formatBytes(detail.body_size)}</span>
          <SignatureBadge status={detail.signature_status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Copy aria-hidden /> Copy as <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => copyAs("cURL")}>cURL</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyAs("fetch")}>fetch</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyAs("HTTPie")}>HTTPie</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {permalink && (
            <Button variant="outline" size="sm" onClick={() => copyText(permalink, "the link")}>
              <Link2 aria-hidden /> Copy link
            </Button>
          )}
          {detail.body_size > 0 && (
            <Button variant="outline" size="sm" asChild>
              <a href={downloadUrl} download>
                <Download aria-hidden /> Download
              </a>
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (window.confirm("Delete this request? This cannot be undone.")) await onDelete();
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          )}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as DetailTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">Headers ({detail.headers.length})</TabsTrigger>
          <TabsTrigger value="query">Query ({detail.query.length})</TabsTrigger>
          <TabsTrigger value="deliveries">
            Deliveries ({detail.deliveries_detail.length})
          </TabsTrigger>
          <TabsTrigger value="meta">Meta</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <TabsContent value="body">
            <BodyViewer detail={detail} downloadUrl={downloadUrl} />
          </TabsContent>
          <TabsContent value="headers" className="grid gap-3">
            {detail.headers_masked && canReveal && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Credentials and signatures are hidden. Revealing them is recorded in the audit
                  log.
                </span>
                <Button size="sm" variant="outline" onClick={reveal} disabled={revealing}>
                  <Eye aria-hidden /> Reveal
                </Button>
              </div>
            )}
            <PairTable
              pairs={detail.headers}
              onRevealClick={canReveal && detail.headers_masked ? reveal : undefined}
            />
          </TabsContent>
          <TabsContent value="query">
            {detail.query.length === 0 ? (
              <p className="text-muted-foreground text-sm">No query string.</p>
            ) : (
              <PairTable pairs={detail.query} />
            )}
          </TabsContent>
          <TabsContent value="deliveries">
            <DeliveriesTimeline deliveries={detail.deliveries_detail} onRetry={onRetryDelivery} />
          </TabsContent>
          <TabsContent value="meta">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <Meta label="Request ID" value={detail.id} mono />
              <Meta label="Received" value={new Date(detail.received_at).toLocaleString()} />
              <Meta label="Source IP" value={detail.source_ip ?? "unknown"} mono />
              <Meta label="User agent" value={detail.user_agent ?? "none"} mono />
              <Meta label="URL" value={detail.url} mono />
              <Meta
                label="Size"
                value={`${formatBytes(detail.body_size)} (${detail.body_size} bytes)`}
              />
              <Meta label="SHA-256" value={detail.body_sha256 ?? "none"} mono />
              <Meta
                label="Processing"
                value={
                  detail.duration_ms === null ? "unknown" : `${detail.duration_ms.toFixed(2)} ms`
                }
              />
              <Meta label="Responded with" value={String(detail.response_status || "none")} />
            </dl>
          </TabsContent>
        </div>
      </Tabs>
    </article>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : ""}>{value}</dd>
    </>
  );
}

function PairTable({
  pairs,
  onRevealClick,
}: {
  pairs: [string, string][];
  onRevealClick?: (() => void) | undefined;
}) {
  return (
    <table className="w-full table-fixed font-mono text-xs">
      <tbody>
        {pairs.map(([name, value], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: names repeat and the list never reorders
          <tr key={i} className="border-border/50 border-b align-top last:border-0">
            <th
              scope="row"
              className="text-muted-foreground w-1/3 truncate py-1 pr-4 text-left font-normal"
            >
              {name}
            </th>
            <td className="py-1 break-all">
              {value === MASKED_VALUE ? (
                onRevealClick ? (
                  <button
                    type="button"
                    onClick={onRevealClick}
                    className="text-muted-foreground hover:text-foreground"
                    title="Click to reveal"
                  >
                    {value}
                  </button>
                ) : (
                  <span className="text-muted-foreground" title="Hidden: sensitive header">
                    {value}
                  </span>
                )
              ) : (
                value
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
