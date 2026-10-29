"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Inbox, type InboxSource } from "@/components/inbox/inbox";
import type { RequestPage } from "@/components/inbox/types";
import { useTRPC, useTRPCClient } from "@/lib/trpc/client";

type Props = {
  orgSlug: string;
  endpointSlug: string;
  endpointId: string;
  initial: RequestPage;
  since: string;
  selectedId: string | undefined;
  canReveal: boolean;
  canDelete: boolean;
  appUrl: string;
  tunnels: number;
};

export function EndpointInbox(props: Props) {
  const { orgSlug, endpointSlug, endpointId, canReveal, canDelete, appUrl } = props;
  const router = useRouter();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const source = useMemo<InboxSource>(
    () => ({
      key: `${orgSlug}/${endpointSlug}`,
      list: (filter, cursor) =>
        client.request.list.query({
          orgSlug,
          endpointSlug,
          ...filter,
          ...(cursor ? { cursor } : {}),
        }),
      get: (id, reveal) => client.request.get.query({ orgSlug, endpointSlug, id, reveal }),
      streamAccess: () =>
        queryClient.fetchQuery({
          ...trpc.stream.token.queryOptions({ orgSlug, endpointId }),
          // The hook decides when to reuse a token; always mint a fresh one here.
          staleTime: 0,
        }),
      remove: canDelete
        ? async (id: string) => {
            await client.request.delete.mutate({ orgSlug, endpointSlug, id });
          }
        : undefined,
      retryDelivery: canDelete
        ? async (id: string) => {
            await client.delivery.retry.mutate({ orgSlug, id });
          }
        : undefined,
      bodyUrl: (id) => `/api/orgs/${orgSlug}/endpoints/${endpointSlug}/requests/${id}/body`,
      permalink: (id) => `${appUrl}/${orgSlug}/endpoints/${endpointSlug}/requests/${id}`,
      canReveal,
    }),
    [orgSlug, endpointSlug, endpointId, canReveal, canDelete, appUrl, client, queryClient, trpc],
  );

  return (
    <Inbox
      source={source}
      initial={props.initial}
      since={props.since}
      initialSelectedId={props.selectedId}
      onResync={() => router.refresh()}
      initialTunnels={props.tunnels}
    />
  );
}
