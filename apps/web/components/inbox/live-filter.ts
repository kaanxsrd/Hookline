import type { RequestFilter, RequestSummary } from "./types";

/**
 * Whether a live request belongs in a filtered list. Full-text search needs
 * the body, which live events do not carry, so a search never admits live
 * requests (the list shows how many arrived instead). Fresh requests have no
 * deliveries yet.
 */
export function matchesLive(summary: RequestSummary, filter: RequestFilter): boolean {
  if (filter.q) return false;
  if (filter.methods && !filter.methods.includes(summary.method)) return false;
  if (filter.signature && !filter.signature.includes(summary.signature_status)) return false;
  if (filter.delivery && !filter.delivery.includes("none")) return false;
  if (filter.to && summary.received_at > filter.to) return false;
  if (filter.from && summary.received_at < filter.from) return false;
  return true;
}
