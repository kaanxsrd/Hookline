"use client";

import { useEffect, useRef, useState } from "react";
import type { DeliveryStatus, RequestSummary } from "./types";

export type LiveStatus = "connecting" | "live" | "reconnecting";

export type StreamAccess = {
  url: string;
  token: string;
  /** When the token stops being accepted for new connections (epoch ms). */
  expiresAt: number;
};

/** A delivery changed status; `statuses` are all of the request's deliveries, in order. */
export type DeliveryEvent = {
  request_id: string;
  delivery_id: string;
  status: DeliveryStatus;
  statuses: DeliveryStatus[];
};

type Handlers = {
  onRequest: (summary: RequestSummary) => void;
  onDelivery?: (event: DeliveryEvent) => void;
  onEndpoint?: (changes: Record<string, unknown>) => void;
  /** More requests were missed than the edge replays; reload the list. */
  onResync?: () => void;
};

type Options = Handlers & {
  /** Fetches a stream URL and token (they expire after five minutes). */
  getAccess: () => Promise<StreamAccess>;
  /** Resume point: the newest request already shown, or a UUIDv7 from before the page rendered. */
  since: string;
};

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Reuse a token for reconnects while it has at least this long left. */
const TOKEN_REUSE_MARGIN_MS = 60_000;

/**
 * Holds the SSE connection to the edge for one endpoint.
 *
 * EventSource's own reconnect would eventually reuse an expired token, so
 * errors close the source and reconnect with last_event_id after an
 * exponential backoff with jitter; the edge replays what was missed. Tokens
 * are reused while fresh, the stream drops as soon as the browser reports
 * `offline`, and comes back on `online`.
 */
export function useRequestStream({ getAccess, since, ...handlers }: Options): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  // Callbacks change identity on every render; the connection must not.
  const access = useRef(getAccess);
  const on = useRef(handlers);
  access.current = getAccess;
  on.current = handlers;
  const lastId = useRef(since);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = MIN_BACKOFF_MS;
    let stopped = false;
    let cached: StreamAccess | null = null;

    const fresh = async (): Promise<StreamAccess> => {
      if (cached && cached.expiresAt - Date.now() > TOKEN_REUSE_MARGIN_MS) return cached;
      cached = await access.current();
      return cached;
    };

    const nextBackoff = () => {
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      return delay / 2 + Math.random() * (delay / 2);
    };

    const schedule = (delay: number) => {
      source?.close();
      source = null;
      if (stopped) return;
      setStatus("reconnecting");
      clearTimeout(timer);
      timer = setTimeout(connect, delay);
    };

    async function connect() {
      if (stopped) return;
      let target: StreamAccess;
      try {
        target = await fresh();
      } catch {
        schedule(nextBackoff());
        return;
      }
      if (stopped) return;
      const url = new URL(target.url);
      url.searchParams.set("token", target.token);
      url.searchParams.set("last_event_id", lastId.current);

      const es = new EventSource(url);
      source = es;
      let opened = false;
      es.onopen = () => {
        opened = true;
        backoff = MIN_BACKOFF_MS;
        setStatus("live");
      };
      es.onerror = () => {
        // Failing before the stream opened may mean the token was refused.
        if (!opened) cached = null;
        schedule(nextBackoff());
      };
      const data = (e: Event) => JSON.parse((e as MessageEvent<string>).data) as unknown;
      es.addEventListener("request", (e) => {
        const summary = data(e) as RequestSummary;
        lastId.current = summary.id;
        on.current.onRequest(summary);
      });
      es.addEventListener("delivery", (e) => on.current.onDelivery?.(data(e) as DeliveryEvent));
      es.addEventListener("endpoint", (e) =>
        on.current.onEndpoint?.(data(e) as Record<string, unknown>),
      );
      es.addEventListener("resync", () => on.current.onResync?.());
      es.addEventListener("reconnect", (e) => {
        const { retry_ms } = data(e) as { retry_ms?: number };
        schedule(retry_ms ?? MIN_BACKOFF_MS);
      });
    }

    const onOffline = () => {
      clearTimeout(timer);
      source?.close();
      source = null;
      setStatus("reconnecting");
    };
    const onOnline = () => {
      backoff = MIN_BACKOFF_MS;
      schedule(0);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return status;
}
