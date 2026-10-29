import { z } from "zod";
import { ApiError, json, readJson } from "@/lib/api/http";
import { publicRoute } from "@/lib/api/route";
import { clientIp } from "@/lib/client-ip";
import { getDb } from "@/lib/db";
import { POLL_INTERVAL_SECONDS, requestDeviceCode } from "@/lib/device-codes";
import { env } from "@/lib/env";

const body = z.object({
  /** Shown on the approval page, e.g. the machine's hostname. */
  client_name: z
    .string()
    .trim()
    .max(64)
    .regex(/^[\w .@()-]*$/, "Use letters, digits and simple punctuation")
    .optional(),
});

/** Starts `hookline login`: returns a device code to poll with and a code for the user. */
export const POST = publicRoute(async ({ request }) => {
  const input = await readJson(request, body);
  const result = await requestDeviceCode(getDb(), {
    clientName: input.client_name || null,
    ip: clientIp(request.headers),
  });
  if (!result.ok) {
    throw new ApiError(
      429,
      "rate_limited",
      "Too many login attempts from this address. Try again later.",
    );
  }
  const verification = new URL("/cli/authorize", env().APP_URL);
  const complete = new URL(verification);
  complete.searchParams.set("code", result.userCode);
  return json(
    {
      device_code: result.deviceCode,
      user_code: result.userCode,
      verification_uri: verification.toString(),
      verification_uri_complete: complete.toString(),
      expires_in: result.expiresIn,
      interval: POLL_INTERVAL_SECONDS,
    },
    201,
  );
});
