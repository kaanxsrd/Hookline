"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LiveRequestList } from "@/components/inbox/live-request-list";
import type { RequestSummary } from "@/components/inbox/types";
import { anonymousRequestDetail, anonymousStreamAccess } from "./actions";

type Props = {
  slug: string;
  /** The share-link token when the page was opened through one. */
  shareToken: string | undefined;
  /** Whether this browser created the endpoint (and may claim it). */
  isCreator: boolean;
  initial: RequestSummary[];
  since: string;
};

export function LiveInbox({ slug, shareToken, isCreator, initial, since }: Props) {
  const router = useRouter();
  return (
    <div className="mt-10 grid gap-6">
      {isCreator && (
        <div className="bg-primary/10 border-primary/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
          <span>This endpoint disappears in 24 hours. Sign up to keep it and its requests.</span>
          <Link
            href="/sign-up?next=/onboarding"
            className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
          >
            Sign up to keep it <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}
      <LiveRequestList
        initial={initial}
        since={since}
        getAccess={() => anonymousStreamAccess(slug, shareToken)}
        loadDetail={(id) => anonymousRequestDetail(slug, shareToken, id)}
        onResync={() => router.refresh()}
        emptyText="Waiting for the first request. Send one to the URL above; it appears here instantly."
      />
    </div>
  );
}
