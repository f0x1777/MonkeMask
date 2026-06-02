import { describe, it, expect } from "vitest";

import { parseSession } from "./session";

describe("v2 session gate", () => {
  it("returns null when no session cookie is present", () => {
    expect(parseSession(undefined)).toBeNull();
  });

  it("returns null for an unverified token (stub until Task 4 wires real JWT)", () => {
    expect(parseSession("not-a-real-jwt")).toBeNull();
  });
});
