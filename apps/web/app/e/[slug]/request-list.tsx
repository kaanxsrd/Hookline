import type { Pair } from "@hookline/db/schema";
import { isSensitiveHeader, MASKED_VALUE } from "@hookline/shared";
import { describeBody, formatBytes } from "@/lib/body";

export type CapturedRequest = {
  id: string;
  receivedAt: Date;
  method: string;
  path: string;
  query: Pair[];
  headers: Pair[];
  contentType: string | null;
  bodyInline: Uint8Array | null;
  bodyS3Key: string | null;
  bodySize: number;
  sourceIp: string | null;
  responseStatus: number | null;
};

const methodColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  POST: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  PUT: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  PATCH: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function MethodChip({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex w-16 justify-center rounded px-1.5 py-0.5 font-mono text-xs font-medium ${
        methodColors[method] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {method}
    </span>
  );
}

function relativeTime(date: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function RequestList({ requests, now }: { requests: CapturedRequest[]; now: Date }) {
  return (
    <ul className="divide-y rounded-lg border">
      {requests.map((r) => (
        <li key={r.id}>
          <details className="group">
            <summary className="hover:bg-accent/50 flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm">
              <MethodChip method={r.method} />
              <span className="min-w-0 flex-1 truncate font-mono">
                {r.path}
                {r.query.length > 0 && (
                  <span className="text-muted-foreground">
                    ?{r.query.map(([k, v]) => `${k}=${v}`).join("&")}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
                {formatBytes(r.bodySize)}
              </span>
              <time
                dateTime={r.receivedAt.toISOString()}
                title={r.receivedAt.toISOString()}
                className="text-muted-foreground w-16 text-right text-xs"
              >
                {relativeTime(r.receivedAt, now)}
              </time>
            </summary>
            <RequestDetail request={r} />
          </details>
        </li>
      ))}
    </ul>
  );
}

function RequestDetail({ request: r }: { request: CapturedRequest }) {
  const body = describeBody(r.bodyInline, r.contentType);
  return (
    <div className="bg-muted/30 grid gap-6 border-t px-4 py-4 text-sm">
      <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt>ID</dt>
        <dd className="text-foreground break-all">{r.id}</dd>
        <dt>From</dt>
        <dd className="text-foreground">{r.sourceIp ?? "unknown"}</dd>
        <dt>Responded</dt>
        <dd className="text-foreground">{r.responseStatus ?? "–"}</dd>
      </dl>

      <section>
        <h3 className="mb-2 font-medium">Headers</h3>
        <table className="w-full table-fixed font-mono text-xs">
          <tbody>
            {r.headers.map(([name, value], i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: header names repeat and the list never reorders, so position is the identity
              <tr key={i} className="align-top">
                <th
                  scope="row"
                  className="text-muted-foreground w-1/3 truncate py-0.5 pr-4 text-left font-normal"
                >
                  {name}
                </th>
                <td className="py-0.5 break-all">
                  {isSensitiveHeader(name) ? (
                    <span className="text-muted-foreground" title="Hidden: sensitive header">
                      {MASKED_VALUE}
                    </span>
                  ) : (
                    value
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-2 font-medium">
          Body{" "}
          <span className="text-muted-foreground font-normal">({formatBytes(r.bodySize)})</span>
        </h3>
        {r.bodyS3Key ? (
          <p className="text-muted-foreground">
            This body is larger than 64 KB and kept in object storage; the full inspector shows it.
          </p>
        ) : body.kind === "empty" ? (
          <p className="text-muted-foreground">No body.</p>
        ) : (
          <pre className="bg-background max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs">
            {body.kind === "binary" ? body.hex : body.text}
          </pre>
        )}
        {body.kind === "binary" && body.truncated && (
          <p className="text-muted-foreground mt-1 text-xs">Showing the first 512 bytes.</p>
        )}
      </section>
    </div>
  );
}
