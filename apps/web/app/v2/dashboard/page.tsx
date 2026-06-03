import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/v2/jwt";
import { SESSION_COOKIE } from "../../../lib/v2/session";
import { DashboardClient } from "./DashboardClient";

// Protected. Validates the session JWT issued by /api/v2/auth/verify, then renders
// the signed-in anonymizer dashboard.
export default async function Dashboard() {
  const session = await getSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/v2/sign-in");

  return (
    <DashboardClient
      wallet={session.wallet_pubkey}
      role={session.role}
      country={session.country}
    />
  );
}
