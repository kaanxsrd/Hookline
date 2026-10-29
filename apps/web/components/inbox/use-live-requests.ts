"use client";

import { useEffect, useRef, useState } from "react";
import type { RequestSummary } from "./types";

export type LiveStatus = "connecting" | "live" | "reconnecting";

export type StreamAccess = {
  url: string;
  token: string;
  /** When the token stops being accepted for new connections (epoch ms). */
  expiresAt: number;
};

type Options = {
  /** Requests already rendered, newest first. */
  initial: RequestSummary[];
  /** Fetches a fresh stream URL and token (they expire after five minutes). */
  getAccess: () => Promise<StreamAccess>;
  /** Called when the server says too many events were missed to replay. */
  onResync?: () => void;
  /** Most rows kept in memory. */
  limit?: number;
};

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Reuse a token for reconnects while it has at least this long left. */
const TOKEN_REUSE_MARGIN_MS = 60_000;

/**
 * Keeps a newest-first list of requests in sync with the edge's SSE stream.
 *
 * EventSource's own reconnect would eventually reuse an expired token, so
 * errors close the source and reconnect with last_event_id after an
 * exponential backoff with jitter; the edge replays what was missed. Tokens
 * are reused while they are fresh, so a reconnect is a single request.
 */
export function useLiveRequests({ initial, getAccess, onResync, limit = 500 }: Options) {
  const [requests, setRequests] = useState(initial);
  const [status, setStatus] = useState<LiveStatus>("connecting");

  // Callbacks change identity on every render; the connection must not.
  const access = useRef(getAccess);
  const resync = useRef(onResync);
  access.current = getAccess;
  resync.current = onResync;
  const lastId = useRef(initial[0]?.id);

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
      if (lastId.current) url.searchParams.set("last_event_id", lastId.current);

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
      es.addEventListener("request", (e) => {
        const summary = JSON.parse((e as MessageEvent<string>).data) as RequestSummary;
        lastId.current = summary.id;
        setRequests((prev) =>
          prev.some((r) => r.id === summary.id) ? prev : [summary, ...prev].slice(0, limit),
        );
      });
      es.addEventListener("resync", () => resync.current?.());
      es.addEventListener("reconnect", (e) => {
        const { retry_ms } = JSON.parse((e as MessageEvent<string>).data) as { retry_ms?: number };
        schedule(retry_ms ?? MIN_BACKOFF_MS);
      });
    }

    function nextBackoff(): number {
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      return delay / 2 + Math.random() * (delay / 2);
    }

    // The browser knows about lost connectivity before TCP does: drop the
    // stream right away, then reconnect (and replay) as soon as it is back.
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
  }, [limit]);

  return { requests, status };
}
