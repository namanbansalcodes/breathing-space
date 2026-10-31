# Breathing Space

Inserts blank lines at meaningful boundaries so dense code reads faster.

It only ever *adds* blank lines. It never reformats, reorders, wraps, or deletes
anything — that is your formatter's job, not this one's.

v1 is **Python only**.

## Before / after

```python
def load(paths, strict=False):
    """Read every path and merge the results."""
    out = {}
    for p in paths:
        if not p.exists():
            if strict:
                raise FileNotFoundError(p)
            continue
        data = json.loads(p.read_text())
        out.update(data)
    # drop anything the caller marked private
    for k in list(out):
        if k.startswith("_"):
            del out[k]
    return out
```

At the default `normal` density:

```python
def load(paths, strict=False):
    """Read every path and merge the results."""

    out = {}

    for p in paths:
        if not p.exists():
            if strict:
                raise FileNotFoundError(p)

            continue

        data = json.loads(p.read_text())
        out.update(data)

    # drop anything the caller marked private
    for k in list(out):
        if k.startswith("_"):
            del out[k]

    return out
```

## Use it

One file:

- Command palette: **Add Breathing Space**
- Keybinding: `Cmd+Alt+B` (macOS) / `Ctrl+Alt+B`

A whole folder:

- Right-click a folder in the explorer: **Add Breathing Space to Folder**
- Or command palette: **Add Breathing Space to Folder**, which asks which folder
  when it cannot tell from the workspace.

Either way it rewrites whole files in one edit, so a single undo reverts all of it
— across every file a folder run touched.

## Folder runs

The folder run walks the directory recursively, spaces every `.py` file it finds,
and tells you how many it changed, how many were already fine, and how many it
skipped. It asks for confirmation first, with the file count.

- Files that fail to parse are skipped and listed in the **Breathing Space** output
  channel. One broken file never stops the run.
- Symlinks are not followed, so a cyclic tree cannot trap the walk.
- Directory names in `breathingSpace.folder.excludeDirs` are skipped. The default
  covers `.git`, `.venv`, `venv`, `env`, `node_modules`, `__pycache__`,
  `site-packages`, the usual cache directories, and `build` / `dist`.
- Changed files are saved. Set `breathingSpace.folder.save` to `false` to leave the
  edits unsaved so you can look them over first.
- The progress notification is cancellable. Cancel before it finishes and nothing
  is written at all.

## Density

One dial, `breathingSpace.density`:

| Value | What it adds |
|---|---|
| `compact` | Early exits (`return` / `raise` / `break` / `continue`) and the ends of compound statements. |
| `normal` *(default)* | The above, plus air before branches and loops, before standalone comments, and after docstrings. |
| `airy` | The above, plus separation between consecutive multi-line statements. |

## Safety

- **Insert-only.** The only change made is adding `\n`. Every insertion is checked
  against an invariant: strip blank lines from the output and it must equal the input
  exactly. If it doesn't, the command throws instead of writing.
- **Bails on syntax errors.** If tree-sitter reports any error node, the file is left
  completely untouched and you get a warning. It will not guess at broken code.
- **Idempotent.** Running it twice produces no second change.
- **One undo step.** The whole rewrite is a single `WorkspaceEdit`.
- **Line endings preserved.** CRLF files stay CRLF.

## No formatter integration

Breathing Space deliberately does *not* register as a VS Code formatter, so it will
not displace Black, Ruff, or autopep8 as your default. Registering would only have
been worth it if we could run your real formatter first and then space its output,
and VS Code provides no way to do that: the internal `_executeFormatDocumentProvider`
command reads exactly two arguments (uri and options) and silently ignores any
extension id you pass. Format with your formatter, then hit the keybinding.

## Requirements

VS Code 1.90 or newer. Verified on 1.128.

## Develop

```bash
npm install
npm run build              # tsc typecheck -> out/
npm test                   # vitest, 185 tests
npm run vscode:prepublish  # esbuild CJS bundle + copy the grammar
npx vsce package           # -> breathing-space-0.0.1.vsix (~190 KB)
```

Press F5 for the Extension Development Host.

The shipped package is a single 7 KB CommonJS bundle, the
`web-tree-sitter` runtime, and `tree-sitter-python.wasm`.
Only the Python grammar is included; the other 18 in `@vscode/tree-sitter-wasm` are
build-time only.

MIT. Copyright (c) 2026 Naman Bansal.
