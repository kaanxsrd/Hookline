import "server-only";
import type { ApiScope } from "../api-keys";
import { type ApiCaller, ApiError, apiError, authenticate } from "./http";
import { idempotent } from "./idempotency";
import { rateLimitHeaders, takeToken } from "./rate-limit";

type Context<P> = { params: Promise<P> };
type Handler<P> = (args: { request: Request; caller: ApiCaller; params: P }) => Promise<Response>;

function toResponse(error: unknown): Response {
  if (error instanceof ApiError)
    return apiError(error.status, error.code, error.message, error.details);
  console.error("api route failed", error);
  return apiError(500, "internal", "Something went wrong on our side. Retry shortly.");
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

/**
 * An authenticated /api/v1 route: checks the key and scope, applies the
 * per-key rate limit (RateLimit-* on every answer), honours Idempotency-Key
 * on POST and turns thrown ApiErrors into the standard error shape.
 */
export function apiRoute<P = Record<string, never>>(scope: ApiScope | null, handler: Handler<P>) {
  return async (request: Request, context: Context<P>): Promise<Response> => {
    try {
      const caller = await authenticate(request, scope ?? undefined);
      const decision = await takeToken(caller.key.id);
      const limitHeaders = rateLimitHeaders(decision);
      if (!decision.allowed) {
        return apiError(
          429,
          "rate_limited",
          "Too many requests for this API key. Slow down and retry.",
          undefined,
          { ...limitHeaders, "Retry-After": String(Math.max(1, Math.ceil(1 / 10))) },
        );
      }
      const params = await context.params;
      const run = () => handler({ request, caller, params });
      const key = request.method === "POST" ? request.headers.get("idempotency-key") : null;
      try {
        const response = key !== null ? await idempotent(caller, request, key, run) : await run();
        return withHeaders(response, limitHeaders);
      } catch (error) {
        return withHeaders(toResponse(error), limitHeaders);
      }
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** An unauthenticated /api/v1 route with the standard error shape. */
export function publicRoute<P = Record<string, never>>(
  handler: (args: { request: Request; params: P }) => Promise<Response>,
) {
  return async (request: Request, context: Context<P>): Promise<Response> => {
    try {
      return await handler({ request, params: await context.params });
    } catch (error) {
      return toResponse(error);
    }
  };
}
