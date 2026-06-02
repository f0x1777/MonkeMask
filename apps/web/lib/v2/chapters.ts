// MonkeDAO Local Chapters. The `code` is what's stored as an ambassador's country
// (some countries have several city chapters). Shared by the admin onboarding
// dropdown and the dashboard display.

export type Chapter = { code: string; label: string; flag: string };

export const CHAPTERS: Chapter[] = [
  { code: "AR", label: "Argentina", flag: "🇦🇷" },
  { code: "US-MIA", label: "United States — Miami", flag: "🇺🇸" },
  { code: "US-SF", label: "United States — San Francisco", flag: "🇺🇸" },
  { code: "US-NY", label: "United States — New York", flag: "🇺🇸" },
  { code: "CA-TOR", label: "Canada — Toronto", flag: "🇨🇦" },
  { code: "CA-MTL", label: "Canada — Montreal", flag: "🇨🇦" },
  { code: "CA-VAN", label: "Canada — Vancouver", flag: "🇨🇦" },
  { code: "IT", label: "Italy", flag: "🇮🇹" },
  { code: "ES", label: "Spain", flag: "🇪🇸" },
  { code: "FR", label: "France", flag: "🇫🇷" },
  { code: "HR", label: "Croatia", flag: "🇭🇷" },
  { code: "RS", label: "Serbia", flag: "🇷🇸" },
  { code: "HU", label: "Hungary", flag: "🇭🇺" },
  { code: "RO", label: "Romania", flag: "🇷🇴" },
  { code: "SG", label: "Singapore", flag: "🇸🇬" },
  { code: "DE", label: "Germany", flag: "🇩🇪" },
  { code: "AE", label: "United Arab Emirates", flag: "🇦🇪" },
  { code: "IN", label: "India", flag: "🇮🇳" },
  { code: "VN", label: "Vietnam", flag: "🇻🇳" },
  { code: "JP", label: "Japan", flag: "🇯🇵" },
  { code: "GB", label: "United Kingdom", flag: "🇬🇧" },
  { code: "NL", label: "Netherlands", flag: "🇳🇱" },
];

const BY_CODE = new Map(CHAPTERS.map((c) => [c.code, c]));

export function isChapter(code: string): boolean {
  return BY_CODE.has(code);
}

/** "🇦🇷 Argentina" for a known code, else the raw code. */
export function chapterLabel(code: string | null): string {
  if (!code) return "";
  const c = BY_CODE.get(code);
  return c ? `${c.flag} ${c.label}` : code;
}
