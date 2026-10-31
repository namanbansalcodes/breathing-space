// Copy just the Python grammar next to the bundle. The other 18 grammars in
// @vscode/tree-sitter-wasm are dead weight for a Python-only extension.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require.resolve("@vscode/tree-sitter-wasm/package.json");
const src = join(dirname(pkg), "wasm", "tree-sitter-python.wasm");

mkdirSync("out", { recursive: true });
copyFileSync(src, join("out", "tree-sitter-python.wasm"));
console.log("copied tree-sitter-python.wasm -> out/");
