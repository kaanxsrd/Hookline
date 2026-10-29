import { limitsFor, type PaidPlan } from "@hookline/shared";
import { planLimitRows } from "@/lib/plan-features";

const PLANS: PaidPlan[] = ["free", "pro", "team"];

/** Every plan limit side by side, straight from config/plans.json. */
export function PlanTable() {
  const rows = PLANS.map((p) => planLimitRows(limitsFor(p)));
  return (
    <div className="my-6 w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Limit</th>
            {PLANS.map((p) => (
              <th key={p} className="px-3 py-2 font-medium">
                {limitsFor(p).name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows[0]?.map(([label], i) => (
            <tr key={label}>
              <td className="border-t px-3 py-2">{label}</td>
              {rows.map((r, p) => (
                <td key={PLANS[p]} className="border-t px-3 py-2 tabular-nums">
                  {r[i]?.[1]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
