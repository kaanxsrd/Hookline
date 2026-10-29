import "server-only";
import { getAuth } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { getDb } from "@/lib/db";
import type { Context } from "./init";

export async function createContext(headers: Headers): Promise<Context> {
  const session = await getAuth().api.getSession({ headers });
  return { db: getDb(), session, headers, ip: clientIp(headers) };
}
