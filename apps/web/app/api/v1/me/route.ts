import { schema } from "@hookline/db";
import { eq } from "drizzle-orm";
import { json } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { orgPlan } from "@/lib/plans";

/** The organization and key behind the presented API key (`hookline whoami`). */
export const GET = apiRoute(null, async ({ caller: { db, key, org } }) => {
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
});
