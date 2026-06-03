// v2 session types + cookie names. The JWT mint/verify lives in ./jwt.

export const SESSION_COOKIE = "v2_session";
export const REFRESH_COOKIE = "v2_refresh";

export type V2Role = "ambassador" | "country_ambassador" | "global_admin" | "super_admin";

export type V2Session = {
  wallet_pubkey: string;
  role: V2Role;
  country: string | null; // chapter code for ambassador, country code for country_ambassador, null for global/super
};
