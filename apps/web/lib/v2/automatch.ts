// Auto-match planning: given detected faces + their embeddings + the unlocked
// roster's matcher, decide which known monke covers which faces. Pure (no DOM/React)
// so the grouping + base64 decoding are unit-testable. The component does the actual
// network upload + state mutation.

type RosterMatch = { person_id: string; monke: string };

export type UploadPlan = {
  person_id: string;
  monke: string; // the cutout (data URL) to upload to the session
  faces: number[]; // every detected face index that resolved to this person
};

/** Group detected faces by the roster person they match, so each known monke's
 * cutout is uploaded to the session once and then applied to all of its faces.
 * Faces with no embedding, or that match nobody, are left out (stay uncovered). */
export function planAutoMatch(
  faces: { index: number }[],
  embeddings: Record<number, number[]>,
  match: (embedding: number[]) => RosterMatch | null,
): UploadPlan[] {
  const byPerson = new Map<string, UploadPlan>();
  for (const f of faces) {
    const e = embeddings[f.index];
    if (!e) continue;
    const m = match(e);
    if (!m) continue;
    const g = byPerson.get(m.person_id) ?? { person_id: m.person_id, monke: m.monke, faces: [] };
    g.faces.push(f.index);
    byPerson.set(m.person_id, g);
  }
  return [...byPerson.values()];
}

/** Decode a `data:...;base64,XXXX` URL into its raw bytes (for re-uploading a stored
 * monke cutout to the session as a file). */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
