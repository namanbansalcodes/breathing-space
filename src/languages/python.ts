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
