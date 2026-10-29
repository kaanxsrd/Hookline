import "server-only";
import { type Db, schema } from "@hookline/db";

export type AuditEntry = {
  orgId: string | null;
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Appends to the audit log. Metadata must never contain secrets, header
 * values or request bodies, only identifiers and names.
 */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    orgId: entry.orgId,
    actorUserId: entry.actorUserId ?? null,
    actorApiKeyId: entry.actorApiKeyId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });
}
