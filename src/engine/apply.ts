/** True if the file's newlines are predominantly CRLF. */
function isCrlf(source: string): boolean {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/\n/g) ?? []).length - crlf;
  return crlf > lf;
}

/**
 * Insert a blank line before each zero-indexed line number. Insert-only.
 *
 * Splitting on "\n" alone leaves each existing line holding its own trailing "\r",
 * so no existing terminator is ever rewritten — a mixed-ending file stays mixed
 * rather than being silently renormalized. Only the blank lines we add need a
 * terminator chosen, and they follow the file's dominant style.
 */
export function applyInsertions(source: string, lines: number[]): string {
  const at = new Set(lines);
  const blank = isCrlf(source) ? "\r" : "";
  const out: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (at.has(i)) out.push(blank);
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
 *
 * Deliberately blind to line endings: `stripBlank` drops blank lines before
 * comparing and never inspects terminators, so a corrupted or renormalized
 * newline is invisible here. Line-ending correctness is `applyInsertions`'
 * responsibility, covered by its own tests — do not assume this check covers it.
 */
export function verify(before: string, after: string): void {
  if (stripBlank(before) !== stripBlank(after)) {
    throw new Error("Breathing Space: refusing to edit — content would change");
  }
}
