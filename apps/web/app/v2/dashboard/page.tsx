import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, parseSession } from "../../../lib/v2/session";
import { ui } from "../../theme";

// Protected placeholder. Until Task 4 issues real sessions, parseSession always
// returns null, so this always redirects to sign-in — which is the correct
// "locked" behaviour for the scaffold.
export default async function Dashboard() {
  const session = parseSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/v2/sign-in");

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 20px", color: ui.ivory }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Ambassador dashboard</h1>
      <p style={{ color: ui.textDim, marginTop: 8 }}>
        Signed in as {session.wallet} ({session.role}
        {session.country ? `, ${session.country}` : ""}).
      </p>
    </main>
  );
}
