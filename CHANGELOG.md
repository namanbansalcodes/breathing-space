# Changelog

## 0.0.1

First release.

- `Add Breathing Space` command, bound to `Cmd+Alt+B` / `Ctrl+Alt+B`.
- `Add Breathing Space to Folder`: space every `.py` file under a directory,
  recursively. Available from the explorer context menu on a folder and from the
  command palette.
- Three densities: `compact`, `normal`, `airy`.
- Python only, via tree-sitter.
- Insert-only, with an invariant check that strips blank lines from the output and
  requires it to equal the input exactly.
- Leaves files with syntax errors completely untouched. A folder run skips them and
  lists them in the `Breathing Space` output channel instead of stopping.
- Every rewrite is a single `WorkspaceEdit`, so one undo reverts it — including a
  whole folder run.
- Folder settings: `breathingSpace.folder.excludeDirs` and `breathingSpace.folder.save`.
