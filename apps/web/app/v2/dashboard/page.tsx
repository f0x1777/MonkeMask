import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/v2/jwt";
import { SESSION_COOKIE } from "../../../lib/v2/session";
import { ui } from "../../theme";

// Protected. Validates the real session JWT issued by /api/v2/auth/verify.
export default async function Dashboard() {
  const session = await getSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/v2/sign-in");

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 20px", color: ui.ivory }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Ambassador dashboard</h1>
      <p style={{ color: ui.textDim, marginTop: 8 }}>
        Signed in as {session.wallet_pubkey} ({session.role}
        {session.country ? `, ${session.country}` : ""}).
      </p>
    </main>
  );
}
