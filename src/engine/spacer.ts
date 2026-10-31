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
      // Only a pair on strictly consecutive lines can take a blank line. A larger
      // gap already has breathing room; a gap of 0 means cur starts on prev's own
      // row (a trailing comment, a semicolon), where inserting before
      // cur.startPosition.row would push the blank above the line they share.
      if (cur.startPosition.row - prev.endPosition.row !== 1) continue;
      if (fires(prev, cur, i, enabled, table)) {
        found.add(cur.startPosition.row);
      }
    }
  }
}

function fires(
  prev: Node,
  cur: Node,
  i: number,
  enabled: ReadonlySet<Rule>,
  table: LanguageTable
): boolean {
  // A comment introduces whatever follows it — never split them.
  if (prev.type === table.comment) return false;

  // R3 is an ordinary clause, not an early return: a comment that follows a block
  // end must still be able to reach R5/R7 when R3 is off.
  if (enabled.has("R3") && cur.type === table.comment) return true;
  // At i === 1, prev is the body's first statement — the only place a docstring counts.
  if (enabled.has("R4") && i === 1 && isDocstring(prev, table)) return true;
  if (enabled.has("R2") && table.exits.includes(cur.type)) return true;
  if (enabled.has("R1") && table.blockStarts.includes(cur.type)) return true;
  if (enabled.has("R5") && table.blockStarts.includes(prev.type)) return true;
  if (enabled.has("R7") && prev.endPosition.row > prev.startPosition.row) return true;
  return false;
}

function isDocstring(node: Node, table: LanguageTable): boolean {
  if (node.type !== table.docstring.node) return false;
  if (node.namedChildCount !== 1) return false;
  return node.namedChild(0)?.type === table.docstring.child;
}
