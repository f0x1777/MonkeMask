// Country roster: the in-memory shape + client-side recognition. The whole roster is
// encrypted (with the per-country CK, see ./crypto) into one blob; record_count is the
// only thing the server sees in plaintext. Entries hold ONLY an embedding + the monke
// (no names or other PII), per the design.

export type RosterEntry = {
  person_id: string; // opaque uuid; never a name
  embedding: number[]; // L2-normalised ArcFace 512-d
  monke: string; // the monke cutout (data URL) — a STABLE identity across sessions,
  // not the ephemeral per-session monke id, so a known person re-covers consistently
};

export type Roster = { version: 1; entries: RosterEntry[] };

export function emptyRoster(): Roster {
  return { version: 1, entries: [] };
}

/** Cosine similarity of two L2-normalised vectors (== dot product). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Best roster entry whose embedding matches ``faceEmbedding`` above ``threshold``,
 * or null. ArcFace cosine ~0.5+ is a confident same-person match. */
export function findMatch(
  faceEmbedding: number[],
  roster: Roster,
  threshold = 0.5,
): RosterEntry | null {
  let best: RosterEntry | null = null;
  let bestScore = threshold;
  for (const e of roster.entries) {
    const s = cosine(faceEmbedding, e.embedding);
    if (s >= bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return best;
}

/** Add/replace a person in the roster. If the embedding already matches an existing
 * entry, that entry's monke is updated instead of adding a duplicate. */
export function upsertEntry(
  roster: Roster,
  entry: RosterEntry,
  threshold = 0.6,
): Roster {
  const match = findMatch(entry.embedding, roster, threshold);
  if (match) {
    return {
      ...roster,
      entries: roster.entries.map((e) => (e.person_id === match.person_id ? { ...e, monke: entry.monke } : e)),
    };
  }
  return { ...roster, entries: [...roster.entries, entry] };
}
