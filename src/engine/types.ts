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
