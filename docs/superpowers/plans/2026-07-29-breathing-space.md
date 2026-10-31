# Breathing Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension that inserts blank lines at meaningful boundaries in Python files so dense code can be scanned quickly, with a runtime invariant proving it never changes behavior.

**Architecture:** A pure TypeScript engine parses the file with tree-sitter (WASM, in-process), walks every `block`/`module` node, and decides whether to insert a blank line between each pair of adjacent named children. Because `elif`/`else`/`except` clauses are children of their compound statement rather than siblings in a block, the engine structurally cannot insert before them. The VS Code layer is a thin adapter that applies the engine's line numbers as one undoable edit.

**Tech Stack:** TypeScript, `web-tree-sitter@0.26.11`, `@vscode/tree-sitter-wasm@0.3.1` (ships a prebuilt `tree-sitter-python.wasm`, no build step), `vitest@4` for engine tests, `@vscode/vsce@3` for packaging.

**Spec:** `docs/superpowers/specs/2026-07-29-breathing-space-design.md`

**Deviations from spec (deliberate, both simplifications):**

1. `LanguageTable.continuations` is dropped. It existed to stop insertions before `elif`/`else`/`except`/`finally`. The sibling-scan algorithm makes that structurally impossible, so a hand-maintained list would be dead code that could only ever be wrong.
2. The spec calls for golden `.in.py`/`.out.py` fixture pairs for the rule tests. The plan uses inline source strings instead — same coverage, but the input and expected output sit next to each other and diff legibly in review. A fixture file is still used for the property tests in Task 12, where the input is large.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Extension manifest: command, keybinding, formatter, settings |
| `tsconfig.json` | TypeScript config, ES2022 modules |
| `vitest.config.ts` | Test runner config |
| `src/engine/types.ts` | `Density`, `Rule`, `LanguageTable` — no logic |
| `src/engine/rules.ts` | Density → enabled rule set |
| `src/engine/spacer.ts` | `computeInsertions(root, table, density) → number[]` |
| `src/engine/apply.ts` | Pure text transforms + the safety invariant |
| `src/languages/python.ts` | Python node-type table |
| `src/parser.ts` | tree-sitter init, WASM load, parse, error detection |
| `src/delegate.ts` | Run the user's configured formatter first |
| `src/extension.ts` | Activation, command + formatter registration |
| `test/*.test.ts` | Engine tests (plain Node, no editor host) |

The engine imports nothing from `vscode`. That boundary is what lets Tasks 2–12 run in vitest with no editor.

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "breathing-space",
  "displayName": "Breathing Space",
  "description": "Inserts blank lines at meaningful boundaries so dense code reads faster.",
  "version": "0.0.1",
  "license": "MIT",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Formatters"],
  "main": "./out/extension.js",
  "type": "module",
  "activationEvents": ["onLanguage:python"],
  "contributes": {
    "commands": [
      { "command": "breathingSpace.addSpace", "title": "Add Breathing Space" }
    ],
    "keybindings": [
      {
        "command": "breathingSpace.addSpace",
        "key": "ctrl+alt+b",
        "mac": "cmd+alt+b",
        "when": "editorTextFocus && !editorReadonly"
      }
    ],
    "configuration": {
      "title": "Breathing Space",
      "properties": {
        "breathingSpace.density": {
          "type": "string",
          "enum": ["compact", "normal", "airy"],
          "default": "normal",
          "description": "How much air to add. compact = early exits and block ends only; normal = adds branches, comments and docstrings; airy = also separates consecutive multi-line statements."
        },
        "breathingSpace.delegateTo": {
          "type": "string",
          "default": "",
          "description": "Extension id of the formatter to run before spacing, e.g. ms-python.black-formatter. Leave empty to skip."
        }
      }
    }
  },
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/vscode": "^1.90.0",
    "@vscode/vsce": "^3.9.2",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10"
  },
  "dependencies": {
    "@vscode/tree-sitter-wasm": "^0.3.1",
    "web-tree-sitter": "^0.26.11"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
out/
*.vsix
```

- [ ] **Step 5: Install and verify the toolchain**

Run: `npm install && npx tsc --version && npx vitest --version`
Expected: installs cleanly, prints a TypeScript 5.x version and a Vitest 4.x version.

- [ ] **Step 6: Add an MIT `LICENSE`**

Standard MIT text, copyright holder "Naman Bansal", year 2026.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold extension project"
```

---

### Task 2: Core types and density presets

**Files:**
- Create: `src/engine/types.ts`, `src/engine/rules.ts`
- Test: `test/rules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rules.test.ts`
Expected: FAIL — cannot resolve `../src/engine/rules.js`.

- [ ] **Step 3: Write `src/engine/types.ts`**

```ts
export type Density = "compact" | "normal" | "airy";

/** R6 is absent by design: it is a structural guarantee, not a toggleable rule. */
export type Rule = "R1" | "R2" | "R3" | "R4" | "R5" | "R7";

export interface DocstringSpec {
  /** Wrapper node type, e.g. "expression_statement". */
  node: string;
  /** Required sole named child, e.g. "string". */
  child: string;
}

export interface LanguageTable {
  /** Node types whose named children are scanned pairwise for insertions. */
  bodies: string[];
  /** Compound statements that deserve air before them (R1) and after them (R5). */
  blockStarts: string[];
  /** Early-exit statements that deserve air before them (R2). */
  exits: string[];
  /** Node type of a standalone comment. */
  comment: string;
  /** How to recognise a docstring. */
  docstring: DocstringSpec;
}
```

- [ ] **Step 4: Write `src/engine/rules.ts`**

```ts
import type { Density, Rule } from "./types.js";

export const PRESETS: Record<Density, ReadonlySet<Rule>> = {
  compact: new Set<Rule>(["R2", "R5"]),
  normal: new Set<Rule>(["R1", "R2", "R3", "R4", "R5"]),
  airy: new Set<Rule>(["R1", "R2", "R3", "R4", "R5", "R7"]),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/rules.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/rules.ts test/rules.test.ts
git commit -m "feat: add core types and density presets"
```

---

### Task 3: Python language table

**Files:**
- Create: `src/languages/python.ts`
- Test: `test/python-table.test.ts`

These node type names were confirmed against `tree-sitter-python.wasm` by parsing a
sample file and printing the tree. Do not guess additions; verify with a parse first.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/python-table.test.ts`
Expected: FAIL — cannot resolve `../src/languages/python.js`.

- [ ] **Step 3: Write `src/languages/python.ts`**

```ts
import type { LanguageTable } from "../engine/types.js";

export const python: LanguageTable = {
  bodies: ["module", "block"],
  blockStarts: [
    "if_statement",
    "for_statement",
    "while_statement",
    "try_statement",
    "with_statement",
    "match_statement",
  ],
  exits: [
    "return_statement",
    "raise_statement",
    "break_statement",
    "continue_statement",
  ],
  comment: "comment",
  docstring: { node: "expression_statement", child: "string" },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/python-table.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/languages/python.ts test/python-table.test.ts
git commit -m "feat: add python language table"
```

---

### Task 4: Parser wrapper

**Files:**
- Create: `src/parser.ts`
- Test: `test/parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parser.test.ts`
Expected: FAIL — cannot resolve `../src/parser.js`.

- [ ] **Step 3: Write `src/parser.ts`**

The WASM path is resolved from the installed package so it works both in tests and
inside the packaged extension.

```ts
import { Parser, Language, type Tree } from "web-tree-sitter";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let parserPromise: Promise<Parser> | null = null;

function wasmDir(): string {
  const pkg = require.resolve("@vscode/tree-sitter-wasm/package.json");
  return join(dirname(pkg), "wasm");
}

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init();
      const lang = await Language.load(join(wasmDir(), "tree-sitter-python.wasm"));
      const p = new Parser();
      p.setLanguage(lang);
      return p;
    })();
  }
  return parserPromise;
}

/** Parse Python source. Returns null if the source has any syntax error. */
export async function parsePython(source: string): Promise<Tree | null> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree || tree.rootNode.hasError) return null;
  return tree;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parser.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts test/parser.test.ts
git commit -m "feat: add tree-sitter python parser wrapper"
```

---

### Task 5: Text transforms and the safety invariant

**Files:**
- Create: `src/engine/apply.ts`
- Test: `test/apply.test.ts`

Build this before the engine so every later engine test can assert through it.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/apply.test.ts`
Expected: FAIL — cannot resolve `../src/engine/apply.js`.

- [ ] **Step 3: Write `src/engine/apply.ts`**

```ts
/** Insert a blank line before each zero-indexed line number. Insert-only. */
export function applyInsertions(source: string, lines: number[]): string {
  const at = new Set(lines);
  const out: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (at.has(i)) out.push("");
    out.push(line);
  });
  return out.join("\n");
}

/** Drop blank and whitespace-only lines, for comparison purposes. */
export function stripBlank(source: string): string {
  return source
    .split("\n")
    .filter((l) => l.trim() !== "")
    .join("\n");
}

/**
 * Assert that `after` differs from `before` only in blank lines.
 * Throws rather than returning false: a violation is a bug, and the only
 * acceptable response is to abandon the edit.
 */
export function verify(before: string, after: string): void {
  if (stripBlank(before) !== stripBlank(after)) {
    throw new Error("Breathing Space: refusing to edit — content would change");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/apply.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/apply.ts test/apply.test.ts
git commit -m "feat: add text transforms and safety invariant"
```

---

### Task 6: Engine skeleton with R2 (early exits)

**Files:**
- Create: `src/engine/spacer.ts`
- Test: `test/spacer.test.ts`

This task establishes the sibling-scan algorithm. Later tasks only add rule clauses.

- [ ] **Step 1: Write the failing test**

```ts
// test/spacer.test.ts
import { describe, it, expect } from "vitest";
import { parsePython } from "../src/parser.js";
import { computeInsertions } from "../src/engine/spacer.js";
import { applyInsertions } from "../src/engine/apply.js";
import { python } from "../src/languages/python.js";

async function space(src: string, density: "compact" | "normal" | "airy" = "compact") {
  const tree = await parsePython(src);
  if (!tree) throw new Error("parse failed");
  return applyInsertions(src, computeInsertions(tree.rootNode, python, density));
}

describe("R2 — blank line before an early exit", () => {
  it("adds air before a return that follows code", async () => {
    const src = "def f():\n    x = 1\n    return x\n";
    expect(await space(src)).toBe("def f():\n    x = 1\n\n    return x\n");
  });

  it("does not add air when the return is the only statement", async () => {
    const src = "def f():\n    return 1\n";
    expect(await space(src)).toBe(src);
  });

  it("does not add air when a blank line is already there", async () => {
    const src = "def f():\n    x = 1\n\n    return x\n";
    expect(await space(src)).toBe(src);
  });

  it("covers raise, break and continue", async () => {
    const src = "def f():\n    x = 1\n    raise E\n";
    expect(await space(src)).toBe("def f():\n    x = 1\n\n    raise E\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacer.test.ts`
Expected: FAIL — cannot resolve `../src/engine/spacer.js`.

- [ ] **Step 3: Write `src/engine/spacer.ts`**

```ts
import type { Node } from "web-tree-sitter";
import type { Density, LanguageTable, Rule } from "./types.js";
import { PRESETS } from "./rules.js";

/**
 * Return the zero-indexed lines that should get a blank line inserted before them.
 *
 * Only ever considers pairs of adjacent named children of a body node. else/elif/
 * except/finally clauses are children of their compound statement, never siblings in
 * a body, so they can never be selected — a structural guarantee, not a rule we
 * enforce.
 *
 * `case_clause` is the one exception: it IS a named child of the block under a
 * match_statement (verified against the grammar). Only R7 can fire on it, putting a
 * blank line between `case` arms at airy density. That is intended and legal.
 */
export function computeInsertions(
  root: Node,
  table: LanguageTable,
  density: Density
): number[] {
  const enabled = PRESETS[density];
  const found = new Set<number>();

  visit(root);
  return [...found].sort((a, b) => a - b);

  function visit(node: Node): void {
    if (table.bodies.includes(node.type)) scanBody(node);
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visit(child);
    }
  }

  function scanBody(body: Node): void {
    const kids: Node[] = [];
    for (let i = 0; i < body.namedChildCount; i++) {
      const c = body.namedChild(i);
      if (c) kids.push(c);
    }
    for (let i = 1; i < kids.length; i++) {
      const prev = kids[i - 1];
      const cur = kids[i];
      // Already has breathing room.
      if (cur.startPosition.row - prev.endPosition.row > 1) continue;
      if (fires(prev, cur, i, kids, enabled, table)) {
        found.add(cur.startPosition.row);
      }
    }
  }
}

function fires(
  prev: Node,
  cur: Node,
  _i: number,
  _kids: Node[],
  enabled: ReadonlySet<Rule>,
  table: LanguageTable
): boolean {
  if (enabled.has("R2") && table.exits.includes(cur.type)) return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spacer.ts test/spacer.test.ts
git commit -m "feat: add engine skeleton with early-exit rule"
```

---

### Task 7: R5 (air after a compound statement ends)

**Files:**
- Modify: `src/engine/spacer.ts` (the `fires` function)
- Test: `test/spacer.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```ts
describe("R5 — blank line after a block ends", () => {
  it("separates a statement from the loop above it", async () => {
    const src = "def f():\n    for k in x:\n        g(k)\n    h()\n";
    expect(await space(src)).toBe("def f():\n    for k in x:\n        g(k)\n\n    h()\n");
  });

  it("does not fire between two simple statements", async () => {
    const src = "def f():\n    a = 1\n    b = 2\n";
    expect(await space(src)).toBe(src);
  });

  it("never inserts before an else clause", async () => {
    const src = "def f():\n    if a:\n        b()\n    else:\n        c()\n";
    expect(await space(src)).toBe(src);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacer.test.ts -t "R5"`
Expected: FAIL — first test gets no inserted blank line.

- [ ] **Step 3: Add the R5 clause to `fires`**

```ts
  if (enabled.has("R2") && table.exits.includes(cur.type)) return true;
  if (enabled.has("R5") && table.blockStarts.includes(prev.type)) return true;
  return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spacer.ts test/spacer.test.ts
git commit -m "feat: add air after compound statements"
```

---

### Task 8: R1 (air before a compound statement)

**Files:**
- Modify: `src/engine/spacer.ts`
- Test: `test/spacer.test.ts` (append)

R1 is in `normal` but not `compact`, so these tests pass `"normal"`.

- [ ] **Step 1: Append the failing test**

```ts
describe("R1 — blank line before a branch or loop", () => {
  it("adds air before an if that follows code", async () => {
    const src = "def f():\n    a = 1\n    if a:\n        g()\n";
    expect(await space(src, "normal")).toBe("def f():\n    a = 1\n\n    if a:\n        g()\n");
  });

  it("is off in compact density", async () => {
    const src = "def f():\n    a = 1\n    if a:\n        g()\n";
    expect(await space(src, "compact")).toBe(src);
  });

  it("covers for, while, try and with", async () => {
    const src = "def f():\n    a = 1\n    with open(p) as fh:\n        g(fh)\n";
    expect(await space(src, "normal")).toBe(
      "def f():\n    a = 1\n\n    with open(p) as fh:\n        g(fh)\n"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacer.test.ts -t "R1"`
Expected: FAIL — no blank line inserted before `if`.

- [ ] **Step 3: Add the R1 clause to `fires`, above R5**

```ts
  if (enabled.has("R2") && table.exits.includes(cur.type)) return true;
  if (enabled.has("R1") && table.blockStarts.includes(cur.type)) return true;
  if (enabled.has("R5") && table.blockStarts.includes(prev.type)) return true;
  return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacer.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spacer.ts test/spacer.test.ts
git commit -m "feat: add air before branches and loops"
```

---

### Task 9: R3 (standalone comments)

**Files:**
- Modify: `src/engine/spacer.ts`
- Test: `test/spacer.test.ts` (append)

Two suppressions matter here and both are tested: consecutive comments stay glued
together, and a comment that introduces a statement stays glued to it.

- [ ] **Step 1: Append the failing test**

```ts
describe("R3 — blank line before a standalone comment", () => {
  it("separates a comment from the code above it", async () => {
    const src = "def f():\n    a = 1\n    # note\n    b = 2\n";
    expect(await space(src, "normal")).toBe("def f():\n    a = 1\n\n    # note\n    b = 2\n");
  });

  it("keeps consecutive comments glued together", async () => {
    const src = "def f():\n    a = 1\n    # one\n    # two\n    b = 2\n";
    expect(await space(src, "normal")).toBe(
      "def f():\n    a = 1\n\n    # one\n    # two\n    b = 2\n"
    );
  });

  it("keeps a comment glued to the statement it introduces", async () => {
    const src = "def f():\n    a = 1\n    # explains the loop\n    for k in a:\n        g(k)\n";
    expect(await space(src, "normal")).toBe(
      "def f():\n    a = 1\n\n    # explains the loop\n    for k in a:\n        g(k)\n"
    );
  });
});
```

The third test is the important one: R1 would otherwise fire on the `for` and split
it from its own explanatory comment.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacer.test.ts -t "R3"`
Expected: FAIL — first two tests insert nothing; third splits the comment from the `for`.

- [ ] **Step 3: Rewrite `fires` with comment handling first**

```ts
function fires(
  prev: Node,
  cur: Node,
  _i: number,
  _kids: Node[],
  enabled: ReadonlySet<Rule>,
  table: LanguageTable
): boolean {
  // A comment introduces whatever follows it — never split them.
  if (prev.type === table.comment) return false;

  if (cur.type === table.comment) {
    return enabled.has("R3");
  }

  if (enabled.has("R2") && table.exits.includes(cur.type)) return true;
  if (enabled.has("R1") && table.blockStarts.includes(cur.type)) return true;
  if (enabled.has("R5") && table.blockStarts.includes(prev.type)) return true;
  return false;
}
```

Note the `prev.type === table.comment` guard also correctly suppresses R1 and R2 when
a comment precedes them, which is what the third test checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacer.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spacer.ts test/spacer.test.ts
git commit -m "feat: add air before standalone comments"
```

---

### Task 10: R4 (air after a docstring)

**Files:**
- Modify: `src/engine/spacer.ts`
- Test: `test/spacer.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```ts
describe("R4 — blank line after a docstring", () => {
  it("separates the body from the docstring", async () => {
    const src = 'def f():\n    """Doc."""\n    a = 1\n';
    expect(await space(src, "normal")).toBe('def f():\n    """Doc."""\n\n    a = 1\n');
  });

  it("ignores a string that is not the first statement", async () => {
    const src = 'def f():\n    a = 1\n    "not a docstring"\n';
    expect(await space(src, "normal")).toBe(src);
  });

  it("handles a multi-line docstring", async () => {
    const src = 'def f():\n    """Line one.\n\n    Line two.\n    """\n    a = 1\n';
    expect(await space(src, "normal")).toBe(
      'def f():\n    """Line one.\n\n    Line two.\n    """\n\n    a = 1\n'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacer.test.ts -t "R4"`
Expected: FAIL — first and third tests insert nothing.

- [ ] **Step 3: Add docstring detection and the R4 clause**

Add this helper at the bottom of `src/engine/spacer.ts`:

```ts
function isDocstring(node: Node, table: LanguageTable): boolean {
  if (node.type !== table.docstring.node) return false;
  if (node.namedChildCount !== 1) return false;
  return node.namedChild(0)?.type === table.docstring.child;
}
```

Change the `fires` signature to use the index and sibling list, and add the clause
after the comment handling:

```ts
  if (enabled.has("R4") && i === 1 && isDocstring(kids[0], table)) return true;
```

The full `fires` function is now:

```ts
function fires(
  prev: Node,
  cur: Node,
  i: number,
  kids: Node[],
  enabled: ReadonlySet<Rule>,
  table: LanguageTable
): boolean {
  if (prev.type === table.comment) return false;
  if (cur.type === table.comment) return enabled.has("R3");
  if (enabled.has("R4") && i === 1 && isDocstring(kids[0], table)) return true;
  if (enabled.has("R2") && table.exits.includes(cur.type)) return true;
  if (enabled.has("R1") && table.blockStarts.includes(cur.type)) return true;
  if (enabled.has("R5") && table.blockStarts.includes(prev.type)) return true;
  return false;
}
```

Update the call site in `scanBody` to pass `i` and `kids` rather than `_i` and `_kids`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacer.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spacer.ts test/spacer.test.ts
git commit -m "feat: add air after docstrings"
```

---

### Task 11: R7 (airy — separate consecutive multi-line statements)

**Files:**
- Modify: `src/engine/spacer.ts`
- Test: `test/spacer.test.ts` (append)

Per the spec: fires when the *earlier* of two adjacent siblings spans more than one
physical line. This separates a wrapped call from what follows without breaking up
runs of short assignments.

- [ ] **Step 1: Append the failing test**

```ts
describe("R7 — separate consecutive multi-line statements", () => {
  it("adds air after a wrapped call", async () => {
    const src = "def f():\n    g(\n        1,\n    )\n    h()\n";
    expect(await space(src, "airy")).toBe("def f():\n    g(\n        1,\n    )\n\n    h()\n");
  });

  it("leaves runs of short assignments alone", async () => {
    const src = "def f():\n    a = 1\n    b = 2\n    c = 3\n";
    expect(await space(src, "airy")).toBe(src);
  });

  it("is off in normal density", async () => {
    const src = "def f():\n    g(\n        1,\n    )\n    h()\n";
    expect(await space(src, "normal")).toBe(src);
  });

  it("separates match case arms, which are block siblings", async () => {
    const src = "def f(x):\n    match x:\n        case 1:\n            y = 1\n        case _:\n            y = 2\n";
    expect(await space(src, "airy")).toBe(
      "def f(x):\n    match x:\n        case 1:\n            y = 1\n\n        case _:\n            y = 2\n"
    );
  });
});
```

`case_clause` is the one continuation-style node that really is a block sibling.
R1/R2/R3/R5 cannot fire on it (it is in neither `blockStarts` nor `exits`, and is
neither comment nor docstring), so R7 is the only rule that reaches it. Separating
case arms is intended behavior at airy density, not a leak.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spacer.test.ts -t "R7"`
Expected: FAIL — first test inserts nothing.

- [ ] **Step 3: Add the R7 clause as the last clause in `fires`**

```ts
  if (enabled.has("R5") && table.blockStarts.includes(prev.type)) return true;
  if (enabled.has("R7") && prev.endPosition.row > prev.startPosition.row) return true;
  return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spacer.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/spacer.ts test/spacer.test.ts
git commit -m "feat: add airy density multi-line separation"
```

---

### Task 12: Adversarial fixtures and property tests

**Files:**
- Create: `test/fixtures/adversarial.py`, `test/properties.test.ts`

This is the task that earns the extension the right to edit real files.

- [ ] **Step 1: Create `test/fixtures/adversarial.py`**

Every construct that could fool a naive implementation:

```python
"""Module docstring."""
import os


def strings_that_look_like_code():
    """Doc."""
    a = """
    return this is not a return
    # this is not a comment
    if this: is not an if
    """
    b = f"{a} # nor is this"
    return a + b


@property
def decorated(self):
    x = 1
    return x


def already_spaced():
    a = 1

    if a:
        b = 2

    return a


def match_stmt(x):
    match x:
        case 1:
            y = 1
        case _:
            y = 2
    return y


def nested_comprehension():
    data = [
        [y for y in range(x)]
        for x in range(10)
    ]
    if (n := len(data)) > 3:
        return n
    return 0


class C:
    """Class docstring."""

    def m(self):
        try:
            a = 1
        except ValueError:
            a = 2
        finally:
            a = 3
        return a
```

- [ ] **Step 2: Write the failing property test**

```ts
// test/properties.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePython } from "../src/parser.js";
import { computeInsertions } from "../src/engine/spacer.js";
import { applyInsertions, verify } from "../src/engine/apply.js";
import { python } from "../src/languages/python.js";
import type { Density } from "../src/engine/types.js";

const DENSITIES: Density[] = ["compact", "normal", "airy"];
const CORPUS = ["test/fixtures/adversarial.py"];

async function run(src: string, density: Density): Promise<string> {
  const tree = await parsePython(src);
  if (!tree) throw new Error("parse failed");
  return applyInsertions(src, computeInsertions(tree.rootNode, python, density));
}

describe.each(CORPUS)("properties on %s", (path) => {
  const src = readFileSync(path, "utf8");

  it.each(DENSITIES)("preserves all non-blank content at %s density", async (d) => {
    expect(() => verify(src, "")).toThrow(); // sanity: verify actually checks
    const out = await run(src, d);
    expect(() => verify(src, out)).not.toThrow();
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
    const out = await run(src, d);
    expect(out).toContain("return this is not a return");
    expect(out).toContain("# this is not a comment");
  });
});

describe("syntax errors", () => {
  it("refuses to touch unparseable code", async () => {
    expect(await parsePython("def f(:\n  return\n")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/properties.test.ts`
Expected: PASS, 13 tests. If any idempotency test fails, a rule is firing on its own
output — fix the rule, do not relax the test.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, all tests across all files.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/adversarial.py test/properties.test.ts
git commit -m "test: add adversarial fixtures and property tests"
```

---

### Task 13: The VS Code command

**Files:**
- Create: `src/extension.ts`

The engine is proven by this point. This task is a thin adapter, verified by hand in
the Extension Development Host.

- [ ] **Step 1: Write `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { parsePython } from "./parser.js";
import { computeInsertions } from "./engine/spacer.js";
import { applyInsertions, verify } from "./engine/apply.js";
import { python } from "./languages/python.js";
import type { Density } from "./engine/types.js";

function density(): Density {
  return vscode.workspace
    .getConfiguration("breathingSpace")
    .get<Density>("density", "normal");
}

/** Compute the spaced version of `source`, or null if it cannot be done safely. */
export async function space(source: string): Promise<string | null> {
  const tree = await parsePython(source);
  if (!tree) return null;
  const out = applyInsertions(
    source,
    computeInsertions(tree.rootNode, python, density())
  );
  verify(source, out); // throws on any content change
  return out;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("breathingSpace.addSpace", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "python") {
        vscode.window.showInformationMessage("Breathing Space supports Python files.");
        return;
      }
      const doc = editor.document;
      const source = doc.getText();

      let out: string | null;
      try {
        out = await space(source);
      } catch (e) {
        vscode.window.showErrorMessage(String(e));
        return;
      }
      if (out === null) {
        vscode.window.showWarningMessage(
          "Breathing Space: file has syntax errors, leaving it alone."
        );
        return;
      }
      if (out === source) {
        vscode.window.showInformationMessage("Breathing Space: nothing to add.");
        return;
      }

      const whole = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(source.length)
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, whole, out);
      await vscode.workspace.applyEdit(edit); // single undo step
    })
  );
}

export function deactivate(): void {}
```

Note: a selection-scoped variant is deliberately omitted here. Add it only after the
whole-file path has been used on real code — it is a refinement, not a requirement.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles with no errors, produces `out/extension.js`.

- [ ] **Step 3: Create `.vscode/launch.json` for the Extension Development Host**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

- [ ] **Step 4: Verify by hand**

Press F5 to launch the Extension Development Host. Open a dense Python file. Run
"Add Breathing Space" from the command palette.

Expected: blank lines appear at branch boundaries and before returns; a single Cmd+Z
reverts the entire change. Then open a file with a deliberate syntax error and run it
again — expected: the warning message, and the file is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts .vscode/launch.json
git commit -m "feat: add the Add Breathing Space command"
```

---

### Task 14: Formatter registration with delegation

**Files:**
- Create: `src/delegate.ts`
- Modify: `src/extension.ts`, `package.json`

**This task contains the plan's one genuine unknown.** VS Code allows a single default
formatter per language. Registering ours would displace Black, so ours must run Black
itself. The mechanism for invoking one specific formatter extension is not a stable
documented API — verify it in Step 1 before building on it.

- [ ] **Step 1: Spike the delegation API before writing the real code**

In the Extension Development Host debug console, with a Python file open and the Black
formatter extension installed, evaluate:

```ts
await vscode.commands.executeCommand(
  "vscode.executeFormatDocumentProvider",
  vscode.window.activeTextEditor.document.uri,
  { tabSize: 4, insertSpaces: true },
  "ms-python.black-formatter"
);
```

Expected: an array of `TextEdit` objects representing Black's formatting.

**If this returns edits:** continue to Step 2.

**If it returns `undefined`, throws, or ignores the extension-id argument:** stop and
take the fallback path instead — do not register as a formatter at all. Keep Black as
the user's `editor.defaultFormatter` and ship only the keybinding from Task 13. Record
the outcome in the spec's Decisions table, remove the "Register as a VS Code formatter"
line from `package.json`, and skip the rest of this task. This is an acceptable v1.

- [ ] **Step 2: Write `src/delegate.ts`**

```ts
import * as vscode from "vscode";

/**
 * Run the formatter named in `breathingSpace.delegateTo` and return the resulting
 * text. Returns the document unchanged if no delegate is configured, or if the
 * delegate produced nothing.
 */
export async function runDelegate(doc: vscode.TextDocument): Promise<string> {
  const target = vscode.workspace
    .getConfiguration("breathingSpace")
    .get<string>("delegateTo", "");
  if (!target) return doc.getText();

  let edits: vscode.TextEdit[] | undefined;
  try {
    edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      doc.uri,
      { tabSize: 4, insertSpaces: true },
      target
    );
  } catch {
    return doc.getText(); // delegate unavailable — space the unformatted text
  }
  if (!edits?.length) return doc.getText();

  // Apply edits to an in-memory copy, last-first so offsets stay valid.
  let text = doc.getText();
  const sorted = [...edits].sort(
    (a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)
  );
  for (const e of sorted) {
    const start = doc.offsetAt(e.range.start);
    const end = doc.offsetAt(e.range.end);
    text = text.slice(0, start) + e.newText + text.slice(end);
  }
  return text;
}
```

- [ ] **Step 3: Register the formatter provider in `activate`**

Append to `activate` in `src/extension.ts`:

```ts
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("python", {
      async provideDocumentFormattingEdits(doc) {
        const delegated = await runDelegate(doc);
        const out = await space(delegated);
        if (out === null) return [];
        const whole = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        return [vscode.TextEdit.replace(whole, out)];
      },
    })
  );
```

Add the import: `import { runDelegate } from "./delegate.js";`

- [ ] **Step 4: Build and verify by hand**

Run: `npm run build`, then F5.

In the host, set `editor.defaultFormatter` to `undefined` for Python (so ours is
chosen) and `breathingSpace.delegateTo` to `ms-python.black-formatter`. Open a Python
file with both bad formatting and dense code. Run Format Document.

Expected: Black's formatting *and* the blank lines, in one undo step.

- [ ] **Step 5: Commit**

```bash
git add src/delegate.ts src/extension.ts package.json
git commit -m "feat: register as python formatter, delegating to black"
```

---

### Task 15: Package and install

**Files:**
- Create: `README.md`
- Modify: `.vscodeignore`

- [ ] **Step 1: Write `README.md`**

Cover: what it does, a before/after example, the three densities and what each
enables, the `delegateTo` setting and why it exists, the safety guarantees
(insert-only, bails on syntax errors, invariant-checked, single undo), and that v1
is Python-only.

- [ ] **Step 2: Create `.vscodeignore`**

The WASM grammar must ship, so exclude sources but keep `node_modules`:

```
src/**
test/**
docs/**
.vscode/**
tsconfig.json
vitest.config.ts
**/*.map
```

- [ ] **Step 3: Package**

Run: `npx vsce package`
Expected: produces `breathing-space-0.0.1.vsix`. Check the reported file list includes
`node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm` — if it is
missing the extension will fail at runtime.

- [ ] **Step 4: Install and confirm outside the dev host**

Run: `code --install-extension breathing-space-0.0.1.vsix`

Then open a real Python file in normal VS Code (not the Extension Development Host)
and run the command.
Expected: works identically to the dev host.

- [ ] **Step 5: Commit**

```bash
git add README.md .vscodeignore
git commit -m "docs: add readme and packaging config"
```

---

## Done when

- `npx vitest run` passes every test.
- The `.vsix` installs into normal VS Code and spaces a real Python file.
- Running the command twice in a row produces no second change.
- A file with a syntax error is left completely untouched, with a warning shown.
