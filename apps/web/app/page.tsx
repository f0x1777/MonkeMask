import { MonkeAnonymizer } from "./MonkeAnonymizer";

// The public, anonymous tool. The same anonymizer is reused, signed-in, at
// /v2/dashboard for Local Ambassadors.
export default function Home() {
  return <MonkeAnonymizer />;
}
