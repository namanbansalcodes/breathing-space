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
    expect(await space("def f():\n    x = 1\n    raise E\n")).toBe(
      "def f():\n    x = 1\n\n    raise E\n"
    );
    expect(await space("for k in y:\n    x = 1\n    break\n")).toBe(
      "for k in y:\n    x = 1\n\n    break\n"
    );
    expect(await space("for k in y:\n    x = 1\n    continue\n")).toBe(
      "for k in y:\n    x = 1\n\n    continue\n"
    );
  });
});

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
    expect(await space("def f():\n    a = 1\n    with open(p) as fh:\n        g(fh)\n", "normal")).toBe(
      "def f():\n    a = 1\n\n    with open(p) as fh:\n        g(fh)\n"
    );
    expect(await space("def f():\n    a = 1\n    for k in a:\n        g(k)\n", "normal")).toBe(
      "def f():\n    a = 1\n\n    for k in a:\n        g(k)\n"
    );
    expect(await space("def f():\n    a = 1\n    while a:\n        g()\n", "normal")).toBe(
      "def f():\n    a = 1\n\n    while a:\n        g()\n"
    );
    expect(
      await space("def f():\n    a = 1\n    try:\n        g()\n    except E:\n        h()\n", "normal")
    ).toBe("def f():\n    a = 1\n\n    try:\n        g()\n    except E:\n        h()\n");
  });
});

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

describe("R4 — blank line after a docstring", () => {
  it("separates the body from the docstring", async () => {
    const src = 'def f():\n    """Doc."""\n    a = 1\n';
    expect(await space(src, "normal")).toBe('def f():\n    """Doc."""\n\n    a = 1\n');
  });

  it("fires only below the first statement, not after every later one", async () => {
    const src = 'def f():\n    """Doc."""\n    a = 1\n    b = 2\n';
    expect(await space(src, "normal")).toBe(
      'def f():\n    """Doc."""\n\n    a = 1\n    b = 2\n'
    );
  });

  it("ignores an expression list that merely starts with a string", async () => {
    const src = 'def f():\n    """Doc.""", x\n    a = 1\n';
    expect(await space(src, "normal")).toBe(src);
  });

  it("handles a multi-line docstring", async () => {
    const src = 'def f():\n    """Line one.\n\n    Line two.\n    """\n    a = 1\n';
    expect(await space(src, "normal")).toBe(
      'def f():\n    """Line one.\n\n    Line two.\n    """\n\n    a = 1\n'
    );
  });
});

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

describe("same-row siblings — the pair must be on consecutive lines", () => {
  it("ignores a trailing comment, which is a sibling on its statement's own row", async () => {
    const src = "def f():\n    a = 1  # note\n    b = 2\n";
    expect(await space(src, "normal")).toBe(src);
  });

  it("ignores statements joined by a semicolon", async () => {
    const src = "def f():\n    a = 1; return a\n";
    expect(await space(src, "compact")).toBe(src);
  });

  it("stays idempotent when a trailing comment sits inside a spaced block", async () => {
    const src = "def f():\n    for k in x:\n        g(k)  # note\n    h()\n";
    const once = await space(src, "normal");
    expect(once).toBe("def f():\n    for k in x:\n        g(k)  # note\n\n    h()\n");
    expect(await space(once, "normal")).toBe(once);
  });
});

describe("comments do not shadow the other rules", () => {
  it("still fires R5 before a comment that follows a block, at compact density", async () => {
    const src = "def f():\n    for k in x:\n        g(k)\n    # after\n    h()\n";
    expect(await space(src, "compact")).toBe(
      "def f():\n    for k in x:\n        g(k)\n\n    # after\n    h()\n"
    );
  });
});

describe("CRLF sources", () => {
  it("spaces a CRLF file without mixing in a lone LF", async () => {
    const src = "def f():\r\n    x = 1\r\n    return x\r\n";
    const out = await space(src);
    expect(out).toBe("def f():\r\n    x = 1\r\n\r\n    return x\r\n");
    expect(out.match(/(?<!\r)\n/g)).toBeNull();
  });

  it("is idempotent on a CRLF file", async () => {
    const src = "def f():\r\n    x = 1\r\n    return x\r\n";
    const once = await space(src);
    expect(await space(once)).toBe(once);
  });
});

describe("bodies other than a function block", () => {
  it("spaces the module body itself", async () => {
    const src = '"""Mod."""\nimport os\nif x:\n    y = 1\nz = 2\n';
    expect(await space(src, "normal")).toBe(
      '"""Mod."""\n\nimport os\n\nif x:\n    y = 1\n\nz = 2\n'
    );
  });

  it("spaces a class body after its docstring", async () => {
    const src = 'class C:\n    """Class doc."""\n    def m(self):\n        return 1\n';
    expect(await space(src, "normal")).toBe(
      'class C:\n    """Class doc."""\n\n    def m(self):\n        return 1\n'
    );
  });
});
