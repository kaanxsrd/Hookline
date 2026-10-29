import { z } from "zod";
import { apiError, json, readJson } from "@/lib/api/http";
import { getDb } from "@/lib/db";
import { pollDeviceCode } from "@/lib/device-codes";

const body = z.object({ device_code: z.string().min(16).max(128) });

const messages = {
  authorization_pending: "Waiting for you to approve the login in the browser.",
  slow_down: "Polling too fast; wait the interval between polls.",
  access_denied: "The login was denied.",
  expired_token: "The code expired. Run `hookline login` again.",
  invalid_grant: "Unknown or already used code. Run `hookline login` again.",
} as const;

/** Polled by the CLI until the user approves; returns the API key once. */
export async function POST(request: Request) {
  const parsed = await readJson(request, body);
  if ("response" in parsed) return parsed.response;
  const result = await pollDeviceCode(getDb(), parsed.data.device_code);
  if (result.status !== "approved") {
    return apiError(400, result.status, messages[result.status]);
  }
  return json({
    api_key: result.apiKey,
    key_prefix: result.keyPrefix,
    org: result.org,
    user: result.user,
  });
}
