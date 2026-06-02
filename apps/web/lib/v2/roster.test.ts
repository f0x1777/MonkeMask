import { describe, it, expect } from "vitest";

import { cosine, emptyRoster, findMatch, upsertEntry, type Roster } from "./roster";

// Build an L2-normalised vector with a single hot dimension (so cosine of same dim = 1).
function unit(dim: number, size = 512): number[] {
  const v = new Array(size).fill(0);
  v[dim] = 1;
  return v;
}

describe("roster recognition", () => {
  it("cosine of identical unit vectors is 1, orthogonal is 0", () => {
    expect(cosine(unit(3), unit(3))).toBeCloseTo(1);
    expect(cosine(unit(3), unit(7))).toBeCloseTo(0);
  });

  it("findMatch returns the entry for a known face and null for an unknown one", () => {
    const roster: Roster = {
      version: 1,
      entries: [
        { person_id: "p1", embedding: unit(10), monke_id: "m1" },
        { person_id: "p2", embedding: unit(20), monke_id: "m2" },
      ],
    };
    expect(findMatch(unit(10), roster)?.monke_id).toBe("m1");
    expect(findMatch(unit(999 % 512), roster)).toBeNull();
  });

  it("upsertEntry adds a new person and updates the monke of a known one", () => {
    let r = emptyRoster();
    r = upsertEntry(r, { person_id: "p1", embedding: unit(10), monke_id: "m1" });
    expect(r.entries).toHaveLength(1);
    // same face, different monke -> updates in place, no duplicate
    r = upsertEntry(r, { person_id: "pX", embedding: unit(10), monke_id: "m9" });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].monke_id).toBe("m9");
    // a new face -> appended
    r = upsertEntry(r, { person_id: "p2", embedding: unit(20), monke_id: "m2" });
    expect(r.entries).toHaveLength(2);
  });
});
