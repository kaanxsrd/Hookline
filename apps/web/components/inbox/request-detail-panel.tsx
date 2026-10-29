import { MASKED_VALUE } from "@hookline/shared";
import { formatBytes } from "@/lib/body";
import type { RequestDetail } from "./types";

/** Headers, query and body of one request. Bodies are only ever rendered as text. */
export function RequestDetailPanel({ detail: d }: { detail: RequestDetail }) {
  return (
    <div className="bg-muted/30 grid gap-6 border-t px-4 py-4 text-sm">
      <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt>ID</dt>
        <dd className="text-foreground break-all">{d.id}</dd>
        <dt>From</dt>
        <dd className="text-foreground">{d.source_ip ?? "unknown"}</dd>
        <dt>Responded</dt>
        <dd className="text-foreground">{d.response_status || "–"}</dd>
      </dl>

      {d.query.length > 0 && (
        <section>
          <h3 className="mb-2 font-medium">Query</h3>
          <PairTable pairs={d.query} />
        </section>
      )}

      <section>
        <h3 className="mb-2 font-medium">Headers</h3>
        <PairTable pairs={d.headers} />
      </section>

      <section>
        <h3 className="mb-2 font-medium">
          Body{" "}
          <span className="text-muted-foreground font-normal">({formatBytes(d.body_size)})</span>
        </h3>
        {d.body_in_storage ? (
          <p className="text-muted-foreground">
            This body is larger than 64 KB and kept in object storage.
          </p>
        ) : d.body.kind === "empty" ? (
          <p className="text-muted-foreground">No body.</p>
        ) : (
          <pre className="bg-background max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs">
            {d.body.kind === "binary" ? d.body.hex : d.body.text}
          </pre>
        )}
        {d.body.kind === "binary" && d.body.truncated && (
          <p className="text-muted-foreground mt-1 text-xs">Showing the first 512 bytes.</p>
        )}
      </section>
    </div>
  );
}

function PairTable({ pairs }: { pairs: [string, string][] }) {
  return (
    <table className="w-full table-fixed font-mono text-xs">
      <tbody>
        {pairs.map(([name, value], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: names repeat and the list never reorders, so position is the identity
          <tr key={i} className="align-top">
            <th
              scope="row"
              className="text-muted-foreground w-1/3 truncate py-0.5 pr-4 text-left font-normal"
            >
              {name}
            </th>
            <td className="py-0.5 break-all">
              {value === MASKED_VALUE ? (
                <span className="text-muted-foreground" title="Hidden: sensitive header">
                  {value}
                </span>
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
