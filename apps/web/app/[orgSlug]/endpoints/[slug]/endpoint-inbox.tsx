"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { LiveRequestList } from "@/components/inbox/live-request-list";
import type { RequestSummary } from "@/components/inbox/types";
import { useTRPC } from "@/lib/trpc/client";

type Props = {
  orgSlug: string;
  endpointSlug: string;
  endpointId: string;
  initial: RequestSummary[];
  since: string;
};

export function EndpointInbox({ orgSlug, endpointSlug, endpointId, initial, since }: Props) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return (
    <LiveRequestList
      initial={initial}
      since={since}
      getAccess={() =>
        queryClient.fetchQuery({
          ...trpc.stream.token.queryOptions({ orgSlug, endpointId }),
          // Every reconnect gets a fresh token; the hook reuses it while it is valid.
          staleTime: 0,
        })
      }
      loadDetail={(id) =>
        queryClient.fetchQuery(trpc.request.get.queryOptions({ orgSlug, endpointSlug, id }))
      }
      onResync={() => router.refresh()}
    />
  );
}
