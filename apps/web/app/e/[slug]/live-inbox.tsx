"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Inbox, type InboxSource } from "@/components/inbox/inbox";
import type { RequestPage } from "@/components/inbox/types";
import { anonymousRequestDetail, anonymousRequestList, anonymousStreamAccess } from "./actions";

type Props = {
  slug: string;
  /** The share-link token when the page was opened through one. */
  shareToken: string | undefined;
  /** Whether this browser created the endpoint (and may claim it). */
  isCreator: boolean;
  initial: RequestPage;
  since: string;
  selectedId: string | undefined;
};

/** The inbox of a temporary endpoint: the same component as the dashboard, without member actions. */
export function LiveInbox({ slug, shareToken, isCreator, initial, since, selectedId }: Props) {
  const router = useRouter();
  const source = useMemo<InboxSource>(
    () => ({
      key: `anonymous:${slug}`,
      list: (filter, cursor) => anonymousRequestList(slug, shareToken, filter, cursor),
      get: (id, reveal) => anonymousRequestDetail(slug, shareToken, id, reveal),
      streamAccess: () => anonymousStreamAccess(slug, shareToken),
      bodyUrl: (id) =>
        `/api/anonymous/${slug}/requests/${id}/body${shareToken ? `?t=${encodeURIComponent(shareToken)}` : ""}`,
      canReveal: true,
    }),
    [slug, shareToken],
  );

  return (
    <div className="mt-8 flex min-h-[70dvh] flex-col gap-4">
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
      <Inbox
        source={source}
        initial={initial}
        since={since}
        initialSelectedId={selectedId}
        onResync={() => router.refresh()}
      />
    </div>
  );
}
