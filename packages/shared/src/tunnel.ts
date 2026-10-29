/**
 * Tunnel protocol hookline.v1: the TypeScript mirror of packages/protocol
 * (Go). docs/tunnel-protocol.md is the specification; keep all three in step.
 */

export const TUNNEL_SUBPROTOCOL = "hookline.v1";
export const TUNNEL_PROTOCOL_VERSION = 1;
export const TUNNEL_PATH = "/v1/tunnel";
export const TUNNEL_MAX_MESSAGE_BYTES = 1 << 20;
export const TUNNEL_PING_INTERVAL_MS = 20_000;
export const TUNNEL_MAX_ENDPOINTS = 10;

export type TunnelHeader = [name: string, value: string];

export type TunnelErrorCode =
  | "target_unreachable"
  | "timeout"
  | "message_too_large"
  | "invalid_message"
  | "unsupported_protocol"
  | "unknown_endpoint"
  | "too_many_tunnels"
  | "internal";

export const TUNNEL_CLOSE = {
  normal: 1000,
  goingAway: 1001,
  messageTooBig: 1009,
  invalidMessage: 4000,
  unauthorized: 4001,
  unknownEndpoint: 4004,
  tooManyTunnels: 4008,
  unsupportedProtocol: 4010,
  pingTimeout: 4011,
  lagging: 4029,
} as const;

/** Close codes after which reconnecting cannot help. */
export const TUNNEL_FATAL_CLOSE_CODES: readonly number[] = [
  TUNNEL_CLOSE.invalidMessage,
  TUNNEL_CLOSE.unauthorized,
  TUNNEL_CLOSE.unknownEndpoint,
  TUNNEL_CLOSE.unsupportedProtocol,
];

export type TunnelHello = {
  type: "hello";
  protocol: number;
  cli_version: string;
  endpoints: string[];
  sync: boolean;
  last_request_id?: string;
};

export type TunnelReady = {
  type: "ready";
  session_id: string;
  endpoints: {
    id: string;
    slug: string;
    url: string;
    name: string;
    response_mode: "static" | "cli_sync";
  }[];
  limits: { max_message_bytes: number; ping_interval_ms: number; concurrent_tunnels: number };
};

export type TunnelRequest = {
  type: "request";
  id: string;
  endpoint_id: string;
  method: string;
  path: string;
  query: string;
  headers: TunnelHeader[];
  body_b64: string;
  body_size: number;
  received_at: string;
  body_omitted?: boolean;
  sync_deadline_ms?: number;
  replayed?: boolean;
  /** Set when a captured request is sent again from the dashboard or API (id is then new). */
  replay_of?: string;
};

export type TunnelResponse = {
  type: "response";
  id: string;
  status: number;
  headers: TunnelHeader[];
  body_b64: string;
  duration_ms: number;
};

export type TunnelError = {
  type: "error";
  id?: string;
  code: TunnelErrorCode | (string & {});
  message: string;
};
export type TunnelPing = { type: "ping" | "pong" };
export type TunnelGoAway = { type: "goaway"; reason: string; reconnect_after_ms: number };

export type TunnelFrame =
  | TunnelHello
  | TunnelReady
  | TunnelRequest
  | TunnelResponse
  | TunnelError
  | TunnelPing
  | TunnelGoAway;
