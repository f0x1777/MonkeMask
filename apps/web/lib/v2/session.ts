// v2 session helper. Pure + unit-testable; the App Router pages call parseSession
// with the cookie value and redirect when it returns null.

export const SESSION_COOKIE = "v2_session";

export type V2Role = "ambassador" | "global_admin" | "super_admin";

export type V2Session = {
  wallet: string;
  role: V2Role;
  country: string | null; // null for global_admin / super_admin
};

/**
 * Parse + validate a v2 session token. Real JWT signature + expiry verification is
 * added in Task 4 (SIWS auth); until then any token is treated as invalid, so every
 * protected route redirects to sign-in. Keeping this a pure function lets us unit
 * test the gate without rendering server components.
 */
export function parseSession(raw: string | undefined): V2Session | null {
  if (!raw) return null;
  // TODO(Task 4): verify the JWT signature against the server secret, check expiry,
  // and decode { wallet, role, country } claims.
  return null;
}
