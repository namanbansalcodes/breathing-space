// test/rules.test.ts
import { describe, it, expect } from "vitest";
import { PRESETS } from "../src/engine/rules.js";

describe("density presets", () => {
  it("compact is the minimal set", () => {
    expect([...PRESETS.compact].sort()).toEqual(["R2", "R5"]);
  });

  it("normal adds branches, comments and docstrings", () => {
    expect([...PRESETS.normal].sort()).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  });

  it("airy is normal plus multi-line separation", () => {
    expect([...PRESETS.airy].sort()).toEqual(["R1", "R2", "R3", "R4", "R5", "R7"]);
  });

  it("each preset is a superset of the one below it", () => {
    for (const r of PRESETS.compact) expect(PRESETS.normal.has(r)).toBe(true);
    for (const r of PRESETS.normal) expect(PRESETS.airy.has(r)).toBe(true);
  });
});
