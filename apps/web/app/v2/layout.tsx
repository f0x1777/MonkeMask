import type { ReactNode } from "react";

// The /v2 platform (Local Ambassadors) lives under this segment so it coexists with
// the existing anonymous tool at `/`, which is left completely untouched. The Solana
// wallet adapter provider is mounted here in Task 5.
export const metadata = {
  title: "MonkeMask v2 — Local Ambassadors",
};

export default function V2Layout({ children }: { children: ReactNode }) {
  return <div data-v2-root>{children}</div>;
}
