# Breathing Space — Design

**Date:** 2026-07-29
**Status:** Approved, ready for implementation planning

## Problem

Dense code is slow to read. Formatters normalize syntax but none of them insert
blank lines: Black and Ruff only *cap* consecutive blanks (2 at module level, 1
inside a function) and *enforce minimums* around `def`/`class`. Neither ever adds
a blank line inside a function body, because where to put one is a judgment about
meaning, not syntax.

The result is files that are technically well-formatted and still exhausting to
read — long procedural bodies with no visual grouping. A 3300-line file with only
10% blank lines forces the reader to re-derive block boundaries from indentation
alone.

No VS Code extension fills this gap for Python. The marketplace results are all
Black/Ruff wrappers; the "blank line organizer" extensions are C#-only.

## Goal

An extension that inserts blank lines at meaningful boundaries so code can be
scanned quickly, with strong guarantees that it cannot alter behavior.

Validated in advance: a prototype implementing the rules below was run against
`rti_inventory.py` (3300 lines), inserting 282 blank lines. The parsed AST was
byte-identical to the original, confirming the rule set is behavior-preserving.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Edit vs. render | Really edit the file | Achievable with no API risk. Per-line vertical spacing via decorations is not officially supported by VS Code. |
| Parsing | Tree-sitter (WASM, in-process) | Real parsing, no external runtime, and grammars for 20+ languages already exist. |
| v1 languages | Python only | Ship the narrowest useful thing. The architecture makes language #2 a config table, not a rewrite. |
| Trigger | Command + keybinding only | **Revised 2026-08-18.** Formatter registration was dropped. It only made sense if we could delegate to the user's real formatter first, and VS Code offers no way to do that: `_executeFormatDocumentProvider` destructures exactly two arguments (`let [e,t]=o` — uri, options) and silently ignores any extension id, so `delegateTo` could never target Black. Registering anyway would displace the user's formatter and lose Black entirely. |
| Configuration | One density dial (`compact` / `normal` / `airy`) | One knob, matches how people think, stays opinionated. |
| Rule representation | Declarative per-language table read by a generic engine | The six rules are conceptually universal; only tree-sitter node *names* differ per language. |
| Distribution | New repo, `.vsix` installed locally | Dogfood before publishing. Marketplace is a later decision. |

Personal project. MIT. Not affiliated with any employer.

## Architecture

```
breathing-space/
  package.json           extension manifest — command, keybinding, settings
  src/
    extension.ts         activation, command registration
    parser.ts            web-tree-sitter loader, WASM grammar, parse cache
    engine/spacer.ts     generic engine: tree → line numbers to insert before
    engine/rules.ts      the six rules + density presets
    engine/verify.ts     safety invariants
    languages/python.ts  node-type table
  wasm/tree-sitter-python.wasm
  test/fixtures/         golden .in.py / .out.py pairs
```

The engine is a pure function and touches no VS Code API:

```ts
computeInsertions(source: string, table: LanguageTable, density: Density): number[]
```

It returns zero-indexed line numbers to insert a blank line *before*. This keeps
the hard logic testable in plain Node with no editor host, and makes the VS Code
layer a thin adapter.

### The language table

Adding a language means supplying node-type names, not logic:

```ts
export const python: LanguageTable = {
  blockStarts:   ["if_statement", "for_statement", "while_statement",
                  "try_statement", "with_statement"],
  exits:         ["return_statement", "raise_statement",
                  "break_statement", "continue_statement"],
  continuations: ["elif_clause", "else_clause",
                  "except_clause", "finally_clause"],
  comment:       "comment",
  docstring:     { node: "expression_statement", child: "string", firstInBody: true },
}
```

`docstring` matches a bare string expression that is the **first** statement in a
function, class, or module body. The `firstInBody` flag is what distinguishes a
docstring from an ordinary string expression elsewhere in the code.

No escape hatch in v1. If a future language cannot be expressed as a table, add
an optional override hook *then* — not before we know it is needed.

## Data flow

**Keybinding path**

1. Read document text and `languageId`.
2. Look up the language table; if absent, show "not supported" and stop.
3. Parse with tree-sitter.
4. If the tree contains `ERROR` nodes, stop (see Safety).
5. Run the engine to get insertion line numbers.
6. Verify invariants against the would-be output.
7. Apply as a single `WorkspaceEdit` so one undo reverts everything.

If a selection is active, only lines within it are considered.

**Format Document path**

Identical, except step 1 is preceded by delegation: run the formatter named in
`breathingSpace.delegateTo` (e.g. `ms-python.black-formatter`), apply its edits
to an in-memory copy, and space *that*. If the setting is empty, skip delegation.

This exists because VS Code allows only one default formatter per language.
Registering as Python's formatter would otherwise displace Black; delegating
means Black keeps working exactly as before, with spacing layered on top.

## The rules

| # | Rule | compact | normal (default) | airy |
|---|---|:-:|:-:|:-:|
| R1 | Blank before `if`/`for`/`while`/`try`/`with` | | ✔ | ✔ |
| R2 | Blank before `return`/`raise`/`break`/`continue` | ✔ | ✔ | ✔ |
| R3 | Blank before a standalone comment that follows code | | ✔ | ✔ |
| R4 | Blank after a docstring | | ✔ | ✔ |
| R5 | Blank when a statement dedents out of a block | ✔ | ✔ | ✔ |
| R6 | **Never** before `elif`/`else`/`except`/`finally` | always | always | always |
| R7 | Blank between consecutive multi-line statements | | | ✔ |

R6 is a guard, not a rule; it cannot be disabled. `normal` is the preset validated
against `rti_inventory.py`.

R7 is defined precisely as: two adjacent sibling statements at the same indent
level, where the *earlier* of the two spans more than one physical line. This
separates a wrapped multi-line call from the statement that follows it, without
breaking up runs of short assignments.

Suppression conditions that apply to every rule:

- Never insert where a blank line already exists.
- Never insert as the first line of a block (Black strips those anyway).
- Never insert after a decorator or an explicit `\` line continuation.
- Never insert between two consecutive standalone comments — comment blocks stay
  glued together.
- Never insert between a standalone comment and the statement it introduces.
- Never insert where the two statements share a line (a trailing comment, or
  semicolon-joined statements). The insertion point is keyed on the start row of
  the later statement, which for a same-row pair is the row they share — so the
  blank line would land above both. Only pairs on strictly consecutive lines are
  eligible.

Two known consequences of the rules above, recorded so they are not later mistaken
for bugs:

- A *trailing* comment on the closing line of a multi-line statement suppresses R7
  for the following statement, because that comment becomes the intervening sibling
  and the "comment introduces what follows" guard treats it as such. Distinguishing
  trailing from standalone comments is out of scope for v1.
- `case_clause` is the one continuation-style node that really is a block sibling,
  so R7 separates `match` arms at airy density. This is intended.

## Safety

The extension edits real source, so the guarantees are load-bearing:

- **Insert-only.** The engine emits insertion points and nothing else. There is
  no delete or reorder code path, so no bug can lose the user's code.
- **Bail on parse errors.** `tree.rootNode.hasError` aborts the run with a message.

  **Known limit, verified against the grammar:** tree-sitter is an error-tolerant
  parser and accepts some input CPython rejects. `if True:\nreturn 1` and a
  tab/space dedent mismatch both parse with `hasError === false` and *no* `ERROR`
  node anywhere — tree-sitter silently reparents the orphaned statement rather
  than flagging it. An explicit `ERROR`/`MISSING` walk does not help, because
  there is nothing to find. So the guarantee is "we bail when tree-sitter reports
  an error", not "we never touch invalid Python".

  This is acceptable because the other guarantees are independent of it: the edit
  is still insert-only, `verify()` still holds, and the result is no more broken
  than the input. The behavior is pinned by tests so it fails loudly if tree-sitter
  ever tightens.
- **Invariant check before applying.** Strip all blank lines from the input and
  from the proposed output; assert the results are identical. This catches any
  engine bug before it reaches the user's file. It is the runtime equivalent of
  the AST-equality check used to validate the prototype.

  **Known blind spot:** because the check strips blank lines before comparing, it
  cannot see a change in line-ending style. Inserting a bare `\n` into a CRLF file
  would pass the invariant while corrupting the file's line endings. That case is
  therefore handled directly in `applyInsertions`, which detects the file's
  terminator and reuses it — not left to `verify()` to catch.
- **Idempotent.** Running twice equals running once.
- **Single undo step.** One `WorkspaceEdit`, one Cmd+Z.

## Testing

- **Golden files.** `test/fixtures/*.in.py` with expected output per density.
  Covers each rule in isolation plus each suppression condition.
- **Property tests over a real corpus.** Run against large real files and assert
  all three invariants hold: strip-equality, idempotency, and no-edit-on-syntax-
  error. Corpus includes a 3300-line production file already known to round-trip.
- **Adversarial fixtures.** Multi-line strings containing `#` and `return`,
  deeply nested comprehensions, decorators, `match`/`case`, walrus operators,
  and files that are already fully spaced.
- Engine tests run in plain Node (vitest). Only `extension.ts` requires
  `@vscode/test-electron`.

## Out of scope for v1

- Languages other than Python. The table architecture exists; the tables do not.
- Marketplace publishing.
- Visual-only (non-editing) mode.
- A bespoke format-on-save setting — formatter registration already gives the
  user VS Code's own.
- Removing blank lines. This tool only adds.

## Open questions

None. All decisions above are settled.
