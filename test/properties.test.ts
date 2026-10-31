import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Node } from "web-tree-sitter";
import { parsePython } from "../src/parser.js";
import { computeInsertions } from "../src/engine/spacer.js";
import { applyInsertions, verify } from "../src/engine/apply.js";
import { python } from "../src/languages/python.js";
import type { Density } from "../src/engine/types.js";

const DENSITIES: Density[] = ["compact", "normal", "airy"];

/**
 * Files with enough structure that every property below has something to bite on.
 * Degenerate inputs (empty, comments only) get their own block further down, so the
 * assertions here never pass vacuously.
 */
const CORPUS = [
  "test/fixtures/adversarial.py",
  "test/fixtures/same_row.py",
  "test/fixtures/crlf.py",
  "test/fixtures/mixed_endings.py",
  "test/fixtures/already_spaced.py",
  "test/fixtures/docstring_only.py",
];

async function insertionsFor(src: string, density: Density): Promise<number[]> {
  const tree = await parsePython(src);
  if (!tree) throw new Error("parse failed");
  return computeInsertions(tree.rootNode, python, density);
}

async function run(src: string, density: Density): Promise<string> {
  return applyInsertions(src, await insertionsFor(src, density));
}

/** Exact source text of every string literal, including nested f-string parts. */
async function stringLiterals(src: string): Promise<string[]> {
  const tree = await parsePython(src);
  if (!tree) throw new Error("parse failed");
  const found: string[] = [];
  const walk = (n: Node): void => {
    if (n.type === "string") found.push(n.text);
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(tree.rootNode);
  return found;
}

/**
 * Delete exactly the lines the engine claims to have inserted. The k-th insertion
 * (sorted, zero-indexed) lands at output index `line + k`, so what is left must be
 * the original file byte for byte — including every original line terminator.
 */
function withoutInserted(out: string, lines: number[]): string {
  const drop = new Set(lines.map((line, k) => line + k));
  return out
    .split("\n")
    .filter((_, i) => !drop.has(i))
    .join("\n");
}

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe.each(CORPUS)("properties on %s", (path) => {
  const src = readFileSync(path, "utf8");

  it("the fixture itself is valid Python", async () => {
    expect(await parsePython(src)).not.toBeNull();
  });

  it.each(DENSITIES)("preserves all non-blank content at %s density", async (d) => {
    const out = await run(src, d);
    expect(() => verify(src, out)).not.toThrow();
  });

  it.each(DENSITIES)("only ever inserts, never rewrites, at %s density", async (d) => {
    const lines = await insertionsFor(src, d);
    const out = await run(src, d);
    expect(withoutInserted(out, lines)).toBe(src);
  });

  it.each(DENSITIES)("is idempotent at %s density", async (d) => {
    const once = await run(src, d);
    const twice = await run(once, d);
    expect(twice).toBe(once);
  });

  it.each(DENSITIES)("still parses cleanly after spacing at %s density", async (d) => {
    const out = await run(src, d);
    expect(await parsePython(out)).not.toBeNull();
  });

  it.each(DENSITIES)("never splits a string literal at %s density", async (d) => {
    const literals = await stringLiterals(src);
    expect(literals.length).toBeGreaterThan(0); // no vacuous pass
    const out = await run(src, d);
    for (const literal of literals) expect(out).toContain(literal);
  });
});

describe("the adversarial fixture's specific traps", () => {
  const src = readFileSync("test/fixtures/adversarial.py", "utf8");

  it.each(DENSITIES)("leaves code-shaped text inside strings alone at %s density", async (d) => {
    const out = await run(src, d);
    expect(out).toContain("    return this is not a return\n");
    expect(out).toContain("    # this is not a comment\n");
    expect(out).toContain("    if this: is not an if\n\n    def neither_is_this():\n");
    expect(out).toContain("class NotAClass:\n    return nope\n");
    expect(out).toContain('f"{a} # nor is this"');
  });

  it.each(DENSITIES)("adds air somewhere at %s density", async (d) => {
    expect((await insertionsFor(src, d)).length).toBeGreaterThan(0);
  });
});

describe("line endings", () => {
  const lfFiles = [
    "test/fixtures/adversarial.py",
    "test/fixtures/same_row.py",
    "test/fixtures/already_spaced.py",
  ];

  it.each(DENSITIES)("a CRLF file gains no lone \\n at %s density", async (d) => {
    const src = readFileSync("test/fixtures/crlf.py", "utf8");
    const lines = await insertionsFor(src, d);
    expect(lines.length).toBeGreaterThan(0); // the check would be vacuous otherwise
    const out = await run(src, d);
    expect(count(out, /\r\n/g)).toBe(count(out, /\n/g));
    expect(count(out, /\r\n/g)).toBeGreaterThan(count(src, /\r\n/g));
  });

  it.each(DENSITIES)("an LF file gains no \\r at %s density", async (d) => {
    for (const path of lfFiles) {
      const src = readFileSync(path, "utf8");
      const out = await run(src, d);
      expect(out).not.toContain("\r");
    }
  });

  it.each(DENSITIES)("a mixed-ending file is not renormalized at %s density", async (d) => {
    const src = readFileSync("test/fixtures/mixed_endings.py", "utf8");
    const srcCrlf = count(src, /\r\n/g);
    const srcLoneLf = count(src, /\n/g) - srcCrlf;
    expect(srcCrlf).toBeGreaterThan(0);
    expect(srcLoneLf).toBeGreaterThan(0);

    const out = await run(src, d);
    // Both styles survive: no pass renormalized the file one way or the other.
    expect(count(out, /\r\n/g)).toBeGreaterThanOrEqual(srcCrlf);
    expect(count(out, /\n/g) - count(out, /\r\n/g)).toBeGreaterThanOrEqual(srcLoneLf);
  });
});

describe("degenerate inputs", () => {
  const files = [
    "test/fixtures/empty.py",
    "test/fixtures/comments_only.py",
  ];

  it.each(DENSITIES)("an empty file is untouched at %s density", async (d) => {
    const src = readFileSync("test/fixtures/empty.py", "utf8");
    expect(src).toBe("");
    expect(await run(src, d)).toBe("");
  });

  it.each(DENSITIES)("a comments-only file is untouched at %s density", async (d) => {
    const src = readFileSync("test/fixtures/comments_only.py", "utf8");
    expect(await run(src, d)).toBe(src);
  });

  it.each(DENSITIES)("degenerate files still verify and reparse at %s density", async (d) => {
    for (const path of files) {
      const src = readFileSync(path, "utf8");
      const out = await run(src, d);
      expect(() => verify(src, out)).not.toThrow();
      expect(await parsePython(out)).not.toBeNull();
    }
  });
});

describe("already-spaced input", () => {
  const src = readFileSync("test/fixtures/already_spaced.py", "utf8");

  it.each(DENSITIES)("is a no-op at %s density", async (d) => {
    expect(await insertionsFor(src, d)).toEqual([]);
    expect(await run(src, d)).toBe(src);
  });
});

describe("the safety net itself", () => {
  it("verify() rejects a real content change", () => {
    expect(() => verify("a = 1\nb = 2\n", "a = 1\n")).toThrow();
    expect(() => verify("a = 1\n", "a = 2\n")).toThrow();
  });

  it("verify() alone cannot catch a blank line inserted inside a string", async () => {
    const before = 'a = """\nx\ny\n"""\n';
    const corrupted = 'a = """\nx\n\ny\n"""\n';

    // The string's contents changed, yet verify() is happy — stripBlank erases the
    // evidence before the comparison.
    expect(() => verify(before, corrupted)).not.toThrow();

    // The string-literal property catches exactly what verify() misses, so the two
    // checks are complementary rather than redundant.
    const literals = await stringLiterals(before);
    expect(literals.length).toBeGreaterThan(0);
    expect(literals.some((s) => !corrupted.includes(s))).toBe(true);
  });
});

describe("syntax errors", () => {
  const broken = [
    "def f(:\n  return\n",
    "class C\n  pass\n",
    "x = (1 + \n",
    "for x in :\n    pass\n",
    "def f():\nreturn 1\n  )\n",
  ];

  it.each(broken)("refuses to touch unparseable code: %j", async (src) => {
    expect(await parsePython(src)).toBeNull();
  });

  /**
   * Known gap, pinned deliberately: tree-sitter recovers from some indentation
   * errors without setting `hasError`, so `parsePython` accepts source that CPython
   * rejects. These pin the current behaviour AND the fact that the engine stays
   * safe on such input — it still only inserts blank lines, and verify() still
   * holds. If tree-sitter ever tightens up, the first assertion fails loudly.
   */
  const acceptedButInvalid = [
    "if True:\nreturn 1\n", // block body never indented
    "def f():\n\treturn 1\n  return 2\n", // tab/space dedent mismatch
  ];

  it.each(acceptedButInvalid)("tree-sitter still accepts %j", async (src) => {
    expect(await parsePython(src)).not.toBeNull();
  });

  it.each(DENSITIES)("stays safe on tree-sitter-accepted bad input at %s density", async (d) => {
    for (const src of acceptedButInvalid) {
      const lines = await insertionsFor(src, d);
      const out = await run(src, d);
      expect(() => verify(src, out)).not.toThrow();
      expect(withoutInserted(out, lines)).toBe(src);
      expect(await run(out, d)).toBe(out);
    }
  });
});
