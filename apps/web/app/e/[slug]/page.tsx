import { schema } from "@hookline/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { authorizeAnonymous, parseVisitorCookie, VISITOR_COOKIE } from "@/lib/anonymous";
import { getDb } from "@/lib/db";
import { env, intakeUrl } from "@/lib/env";
import { RefreshButton } from "./refresh-button";
import { type CapturedRequest, RequestList } from "./request-list";

export const metadata: Metadata = {
  title: "Temporary inbox",
  description: "Requests captured by a temporary Hookline endpoint.",
  robots: { index: false },
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

export default async function AnonymousInboxPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { t } = await searchParams;

  // The view token comes from the share link (?t=) or the creator's cookie.
  const visitor = parseVisitorCookie((await cookies()).get(VISITOR_COOKIE)?.value);
  const token = typeof t === "string" ? t : visitor?.slug === slug ? visitor.token : undefined;
  const endpoint = await authorizeAnonymous(slug, token);
  if (!endpoint || !token) notFound();

  const r = schema.request;
  const requests: CapturedRequest[] = await getDb()
    .select({
      id: r.id,
      receivedAt: r.receivedAt,
      method: r.method,
      path: r.path,
      query: r.query,
      headers: r.headers,
      contentType: r.contentType,
      bodyInline: r.bodyInline,
      bodyS3Key: r.bodyS3Key,
      bodySize: r.bodySize,
      sourceIp: r.sourceIp,
      responseStatus: r.responseStatus,
    })
    .from(r)
    // The lower bound lets PostgreSQL skip partitions older than the endpoint.
    .where(and(eq(r.endpointId, endpoint.id), gte(r.receivedAt, endpoint.createdAt)))
    .orderBy(desc(r.receivedAt), desc(r.id))
    .limit(100);

  const url = intakeUrl(slug);
  const shareUrl = `${env().APP_URL}/e/${slug}?t=${encodeURIComponent(token)}`;
  const curl = `curl -X POST '${url}' -H 'Content-Type: application/json' -d '{"hello":"world"}'`;
  const now = new Date();
  const hoursLeft = Math.max(
    0,
    Math.ceil((endpoint.expiresAt.getTime() - now.getTime()) / 3_600_000),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Your temporary endpoint</h1>
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
            <Clock className="size-4" aria-hidden />
            Expires in {hoursLeft} {hoursLeft === 1 ? "hour" : "hours"}
          </span>
        </div>

        <div className="bg-card flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{url}</code>
          <CopyButton value={url} label="Copy endpoint URL" />
        </div>

        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Send a test request</summary>
          <div className="bg-card mt-2 flex items-start gap-2 rounded-lg border py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all">{curl}</code>
            <CopyButton value={curl} label="Copy curl command" />
          </div>
        </details>

        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Share this inbox</summary>
          <p className="text-muted-foreground mt-2">
            Anyone with this link can read the captured requests.
          </p>
          <div className="bg-card mt-2 flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{shareUrl}</code>
            <CopyButton value={shareUrl} label="Copy share link" />
          </div>
        </details>
      </header>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">
            Requests <span className="text-muted-foreground font-normal">({requests.length})</span>
          </h2>
          <RefreshButton />
        </div>
        {requests.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
            Nothing yet. Send a request to the URL above and refresh.
          </div>
        ) : (
          <RequestList requests={requests} now={now} />
        )}
      </section>
    </main>
  );
}
