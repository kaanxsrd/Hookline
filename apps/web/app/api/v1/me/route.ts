import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { authenticate, json } from "@/lib/api/http";
import { orgPlan } from "@/lib/plans";

/** The organization and key behind the presented API key (`hookline whoami`). */
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { db, key, org } = auth.caller;
  const [user] = key.createdBy
    ? await db
        .select({ email: schema.user.email, name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, key.createdBy))
    : [];
  const { plan } = await orgPlan(db, org.id);
  return json({
    org: { ...org, plan },
    key: { id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes },
    user: user ?? null,
  });
}
