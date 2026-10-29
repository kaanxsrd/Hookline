import { TRPCError } from "@trpc/server";
import { orgPlan } from "@/lib/plans";
import { appRouter } from "@/server/routers/_app";
import { listAudit } from "@/server/routers/audit";
import { createContext } from "@/server/trpc/context";
import { createCallerFactory } from "@/server/trpc/init";

const createCaller = createCallerFactory(appRouter);

/** RFC 4180 field quoting; leading formula characters are neutralized for spreadsheets. */
function csvField(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** GET /api/orgs/{orgSlug}/audit-log[?action=prefix] — the audit log as CSV (admins only). */
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await createContext(request.headers);
  // Reuses the procedure's membership and role checks.
  let org: { id: string; slug: string };
  try {
    const current = await createCaller(ctx).org.current({ orgSlug });
    if (!["admin", "owner"].includes(current.role)) {
      return Response.json(
        { error: { code: "forbidden", message: "Admins only." } },
        { status: 403 },
      );
    }
    org = current;
  } catch (error) {
    if (error instanceof TRPCError) {
      const status = error.code === "UNAUTHORIZED" ? 401 : 404;
      return Response.json(
        { error: { code: error.code.toLowerCase(), message: error.message } },
        { status },
      );
    }
    throw error;
  }

  const action = new URL(request.url).searchParams.get("action")?.slice(0, 64) || undefined;
  const lines = [
    ["time", "actor", "actor_email", "action", "target_type", "target_id", "ip", "metadata"].join(
      ",",
    ),
  ];
  let cursor: string | undefined;
  const { limits } = await orgPlan(ctx.db, org.id);
  // At most 100k rows per export.
  for (let page = 0; page < 200; page++) {
    const { items, nextCursor } = await listAudit(
      ctx.db,
      org.id,
      {
        limit: 500,
        ...(action ? { action } : {}),
        ...(cursor ? { cursor } : {}),
      },
      limits.audit_log_days,
    );
    for (const e of items) {
      lines.push(
        [
          e.createdAt.toISOString(),
          e.actorName ?? (e.actorApiKeyId ? `api_key:${e.actorApiKeyId}` : "system"),
          e.actorEmail,
          e.action,
          e.targetType,
          e.targetId,
          e.ip,
          e.metadata,
        ]
          .map(csvField)
          .join(","),
      );
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hookline-audit-${org.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
