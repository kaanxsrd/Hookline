import { ImageResponse } from "next/og";

export const socialImageSize = { width: 1200, height: 630 };
export const socialImageAlt =
  "Hookline: catch every webhook, replay anything, pipe it to localhost";

/** The card shown when a Hookline link is shared. */
export function socialImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#09090b",
        color: "#fafafa",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, fontWeight: 600 }}
      >
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#6366f1" />
          <path
            d="M11 6v12a5 5 0 0 0 10 0v-3"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M17.5 14.5 21 11l3.5 3.5"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Hookline
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 72,
          fontWeight: 700,
          lineHeight: 1.1,
        }}
      >
        <span>Catch every webhook.</span>
        <span>Replay anything.</span>
        <span style={{ color: "#818cf8" }}>Pipe it to localhost.</span>
      </div>
    </div>,
    socialImageSize,
  );
}
