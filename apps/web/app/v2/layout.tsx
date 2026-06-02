import type { ReactNode } from "react";

import { V2WalletProvider } from "./WalletProvider";

// The /v2 platform (Local Ambassadors). Coexists with the public tool at `/`, which
// is untouched. The Solana wallet adapter is mounted for the whole subtree here.
export const metadata = {
  title: "MonkeMask v2 — Local Ambassadors",
};

export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <V2WalletProvider>
      <div data-v2-root>{children}</div>
    </V2WalletProvider>
  );
}
