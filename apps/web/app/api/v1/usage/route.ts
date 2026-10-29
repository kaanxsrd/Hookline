import { json } from "@/lib/api/http";
import { apiRoute } from "@/lib/api/route";
import { monthUsage } from "@/lib/usage";

/** Usage this month against the plan's limits. */
export const GET = apiRoute(null, async ({ caller: { db, org } }) =>
  json(await monthUsage(db, org.id)),
);
