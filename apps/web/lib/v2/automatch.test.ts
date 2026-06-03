import { describe, it, expect } from "vitest";

import { planAutoMatch, dataUrlToBytes } from "./automatch";

describe("planAutoMatch", () => {
  // Stub matcher: faces 0 and 2 are the same known person "p1"; face 1 is "p2";
  // face 3 has no embedding; face 4 matches nobody.
  const match = (e: number[]) => {
    if (e[0] === 1) return { person_id: "p1", monke: "cutout-1" };
    if (e[0] === 2) return { person_id: "p2", monke: "cutout-2" };
    return null;
  };
  const faces = [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }];
  const embeddings: Record<number, number[]> = {
    0: [1],
    1: [2],
    2: [1],
    4: [9],
    // face 3 intentionally absent (no embedding)
  };

  it("groups faces by matched person so each cutout uploads once", () => {
    const plan = planAutoMatch(faces, embeddings, match);
    expect(plan).toHaveLength(2);
    const p1 = plan.find((p) => p.person_id === "p1")!;
    expect(p1.monke).toBe("cutout-1");
    expect(p1.faces.sort()).toEqual([0, 2]); // both faces of the same person
    const p2 = plan.find((p) => p.person_id === "p2")!;
    expect(p2.faces).toEqual([1]);
  });

  it("skips faces with no embedding and faces that match nobody", () => {
    const plan = planAutoMatch(faces, embeddings, match);
    const covered = plan.flatMap((p) => p.faces);
    expect(covered).not.toContain(3); // no embedding
    expect(covered).not.toContain(4); // no match
  });

  it("returns an empty plan when nothing matches", () => {
    expect(planAutoMatch(faces, embeddings, () => null)).toEqual([]);
  });
});

describe("dataUrlToBytes", () => {
  it("decodes a base64 data URL into the original bytes", () => {
    // "MONKE" -> base64 "TU9OS0U="
    const bytes = dataUrlToBytes("data:image/png;base64,TU9OS0U=");
    expect(Array.from(bytes)).toEqual([..."MONKE"].map((c) => c.charCodeAt(0)));
  });
});
