// test/parser.test.ts
import { describe, it, expect } from "vitest";
import { parsePython } from "../src/parser.js";

describe("parsePython", () => {
  it("parses valid python and reports no error", async () => {
    const tree = await parsePython("def f():\n    return 1\n");
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe("module");
  });

  it("returns null for code with syntax errors", async () => {
    expect(await parsePython("def f(:\n  return\n")).toBeNull();
  });

  it("reuses the parser across calls", async () => {
    const a = await parsePython("x = 1\n");
    const b = await parsePython("y = 2\n");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});
