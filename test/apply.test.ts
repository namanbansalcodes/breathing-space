// test/apply.test.ts
import { describe, it, expect } from "vitest";
import { applyInsertions, stripBlank, verify } from "../src/engine/apply.js";

describe("applyInsertions", () => {
  it("inserts a blank line before each given zero-indexed line", () => {
    expect(applyInsertions("a\nb\nc\n", [1])).toBe("a\n\nb\nc\n");
  });

  it("handles multiple insertions without index drift", () => {
    expect(applyInsertions("a\nb\nc\n", [1, 2])).toBe("a\n\nb\n\nc\n");
  });

  it("is a no-op for an empty insertion list", () => {
    expect(applyInsertions("a\nb\n", [])).toBe("a\nb\n");
  });

  it("gives the inserted blank line CRLF endings in a CRLF file", () => {
    expect(applyInsertions("a\r\nb\r\nc\r\n", [1])).toBe("a\r\n\r\nb\r\nc\r\n");
  });

  it("never leaves a lone LF in a CRLF file", () => {
    const out = applyInsertions("a\r\nb\r\nc\r\n", [1, 2]);
    expect(out).toBe("a\r\n\r\nb\r\n\r\nc\r\n");
    expect(out.match(/(?<!\r)\n/g)).toBeNull();
  });

  it("never introduces a CR into an LF file", () => {
    const out = applyInsertions("a\nb\nc\n", [1, 2]);
    expect(out).toBe("a\n\nb\n\nc\n");
    expect(out).not.toContain("\r");
  });
});

describe("stripBlank", () => {
  it("removes blank and whitespace-only lines", () => {
    expect(stripBlank("a\n\n   \nb\n")).toBe("a\nb");
  });
});

describe("verify", () => {
  it("accepts a pure blank-line insertion", () => {
    expect(() => verify("a\nb\n", "a\n\nb\n")).not.toThrow();
  });

  it("rejects any change to non-blank content", () => {
    expect(() => verify("a\nb\n", "a\nX\n")).toThrow(/refusing to edit/);
  });

  it("rejects dropped lines", () => {
    expect(() => verify("a\nb\n", "a\n")).toThrow(/refusing to edit/);
  });
});
