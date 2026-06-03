import Link from "next/link";

import { ui } from "../theme";

// /v2 landing. The existing public anonymizer stays at `/`; this is the gated
// Local-Ambassador platform entry point.
export default function V2Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 20px", color: ui.ivory }}>
      <h1 style={{ fontSize: 34, fontWeight: 800 }}>
        Monke<span style={{ color: ui.accent }}>Mask</span> v2
      </h1>
      <p style={{ color: ui.textDim, marginTop: 8 }}>
        Private roster tooling for MonkeDAO <strong>Local Ambassadors</strong>. Build
        your country&apos;s member↔monke roster and auto-cover known faces at events.
      </p>
      <Link
        href="/v2/sign-in"
        style={{
          display: "inline-block",
          marginTop: 24,
          padding: "13px 26px",
          borderRadius: 12,
          fontWeight: 700,
          background: ui.accent,
          color: ui.accentText,
          textDecoration: "none",
        }}
      >
        Connect wallet →
      </Link>
    </main>
  );
}
