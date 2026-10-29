import { handleBillingEvent, verifyWebhook } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Stripe webhooks. In development, point Stripe at a Hookline endpoint and
 * forward it here with `hookline listen <slug> --forward
 * http://localhost:3000/api/stripe/webhook` (see docs/deployment.md).
 */
export async function POST(request: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: { code: "not_configured", message: "Billing webhooks are not configured." } },
      { status: 404 },
    );
  }
  const payload = await request.text();
  let event: ReturnType<typeof verifyWebhook>;
  try {
    event = verifyWebhook(payload, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return Response.json(
      { error: { code: "invalid_signature", message: "Signature verification failed." } },
      { status: 400 },
    );
  }
  await handleBillingEvent(getDb(), event);
  return Response.json({ received: true });
}
