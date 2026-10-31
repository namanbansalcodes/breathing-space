// test/python-table.test.ts
import { describe, it, expect } from "vitest";
import { python } from "../src/languages/python.js";

describe("python table", () => {
  it("scans module and block bodies", () => {
    expect(python.bodies).toEqual(["module", "block"]);
  });

  it("knows the compound statements", () => {
    expect(python.blockStarts).toContain("if_statement");
    expect(python.blockStarts).toContain("for_statement");
    expect(python.blockStarts).toContain("while_statement");
    expect(python.blockStarts).toContain("try_statement");
    expect(python.blockStarts).toContain("with_statement");
  });

  it("knows the early exits", () => {
    expect(python.exits.sort()).toEqual([
      "break_statement", "continue_statement", "raise_statement", "return_statement",
    ]);
  });

  it("does not list continuation clauses (they are never block siblings)", () => {
    expect(python.blockStarts).not.toContain("else_clause");
    expect(python.blockStarts).not.toContain("elif_clause");
  });
});
