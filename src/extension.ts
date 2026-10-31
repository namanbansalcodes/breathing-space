import * as vscode from "vscode";
import { join } from "node:path";
import { parsePython, setPythonWasmPath } from "./parser.js";
import { computeInsertions } from "./engine/spacer.js";
import { applyInsertions, verify } from "./engine/apply.js";
import { python } from "./languages/python.js";
import type { Density } from "./engine/types.js";

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("breathingSpace");
}

function density(): Density {
  return config().get<Density>("density", "normal");
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

/** Replace a whole document's text in `edit`. */
function replaceAll(
  edit: vscode.WorkspaceEdit,
  doc: vscode.TextDocument,
  text: string
): void {
  const whole = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
  edit.replace(doc.uri, whole, text);
}

const DEFAULT_SKIP_DIRS = [
  ".git",
  ".hg",
  ".svn",
  ".tox",
  ".nox",
  ".venv",
  "venv",
  "env",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "node_modules",
  "site-packages",
  "build",
  "dist",
];

function skipDirs(): Set<string> {
  return new Set(config().get<string[]>("folder.excludeDirs", DEFAULT_SKIP_DIRS));
}

/**
 * Every `.py` file under `root`, depth-first, skipping the configured directory
 * names. Symlinks are left alone so a cyclic tree cannot trap the walk.
 */
async function pythonFilesUnder(
  root: vscode.Uri,
  token: vscode.CancellationToken
): Promise<vscode.Uri[]> {
  const skip = skipDirs();
  const found: vscode.Uri[] = [];
  const stack = [root];

  while (stack.length > 0) {
    if (token.isCancellationRequested) break;
    const dir = stack.pop()!;

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      continue; // unreadable directory: not our problem, keep walking
    }

    for (const [name, type] of entries) {
      if (type & vscode.FileType.SymbolicLink) continue;
      const uri = vscode.Uri.joinPath(dir, name);
      if (type & vscode.FileType.Directory) {
        if (!skip.has(name)) stack.push(uri);
      } else if (name.endsWith(".py")) {
        found.push(uri);
      }
    }
  }

  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

/** The folder to work on when the command came from the palette, not the explorer. */
async function pickFolder(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0].uri;

  if (folders.length > 1) {
    const pick = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath, uri: f.uri })),
      { placeHolder: "Add breathing space to which folder?" }
    );
    return pick?.uri;
  }

  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Add Breathing Space",
  });
  return chosen?.[0];
}

type Skip = { file: string; reason: string };

async function addSpaceToFolder(
  target: vscode.Uri | undefined,
  log: vscode.OutputChannel
): Promise<void> {
  const folder = target ?? (await pickFolder());
  if (!folder) return;

  const label = vscode.workspace.asRelativePath(folder, false) || folder.fsPath;

  const files = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Breathing Space: finding Python files…" },
    (_p, token) => pythonFilesUnder(folder, token)
  );

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      `Breathing Space: no Python files under ${label}.`
    );
    return;
  }

  const go = "Add Breathing Space";
  const confirm = await vscode.window.showWarningMessage(
    `Add breathing space to ${files.length} Python file${files.length === 1 ? "" : "s"} under ${label}?`,
    { modal: true, detail: "Only blank lines are added. Nothing else is touched." },
    go
  );
  if (confirm !== go) return;

  const edit = new vscode.WorkspaceEdit();
  const touched: vscode.Uri[] = [];
  const skipped: Skip[] = [];
  let unchanged = 0;
  let cancelled = false;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Breathing Space",
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) {
          cancelled = true;
          return;
        }
        const uri = files[i];
        const rel = vscode.workspace.asRelativePath(uri);
        progress.report({
          message: `${i + 1}/${files.length} — ${rel}`,
          increment: 100 / files.length,
        });

        let doc: vscode.TextDocument;
        try {
          doc = await vscode.workspace.openTextDocument(uri);
        } catch (e) {
          skipped.push({ file: rel, reason: String(e) });
          continue;
        }

        const source = doc.getText();
        let out: string | null;
        try {
          out = await space(source);
        } catch (e) {
          skipped.push({ file: rel, reason: String(e) });
          continue;
        }

        if (out === null) {
          skipped.push({ file: rel, reason: "syntax errors" });
        } else if (out === source) {
          unchanged++;
        } else {
          replaceAll(edit, doc, out);
          touched.push(uri);
        }
      }
    }
  );

  if (cancelled) {
    vscode.window.showInformationMessage("Breathing Space: cancelled, nothing changed.");
    return;
  }

  if (touched.length > 0) {
    // One edit for the whole folder, so one undo takes it all back.
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      vscode.window.showErrorMessage("Breathing Space: could not apply the edit.");
      return;
    }
    if (config().get<boolean>("folder.save", true)) {
      for (const uri of touched) {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.isDirty) await doc.save();
      }
    }
  }

  const parts = [
    `${touched.length} file${touched.length === 1 ? "" : "s"} spaced`,
    `${unchanged} already fine`,
  ];
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  const summary = `Breathing Space: ${parts.join(", ")}.`;

  if (skipped.length === 0) {
    vscode.window.showInformationMessage(summary);
    return;
  }

  log.appendLine(`--- ${label}: ${skipped.length} file(s) skipped`);
  for (const s of skipped) log.appendLine(`  ${s.file}: ${s.reason}`);

  const show = "Show skipped";
  const picked = await vscode.window.showWarningMessage(summary, show);
  if (picked === show) log.show(true);
}

async function addSpaceToActiveFile(): Promise<void> {
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

  const edit = new vscode.WorkspaceEdit();
  replaceAll(edit, doc, out);
  await vscode.workspace.applyEdit(edit); // single undo step
}

export function activate(context: vscode.ExtensionContext): void {
  // The grammar ships beside the bundle; do not go looking in node_modules.
  setPythonWasmPath(join(context.extensionPath, "out", "tree-sitter-python.wasm"));

  const log = vscode.window.createOutputChannel("Breathing Space");

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand("breathingSpace.addSpace", addSpaceToActiveFile),
    vscode.commands.registerCommand(
      "breathingSpace.addSpaceToFolder",
      (uri?: vscode.Uri) => addSpaceToFolder(uri, log)
    )
  );
}

export function deactivate(): void {}
