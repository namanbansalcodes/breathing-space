import { Parser, Language, type Tree } from "web-tree-sitter";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

let parserPromise: Promise<Parser> | null = null;
let wasmPath: string | null = null;

/**
 * Point the loader at an explicit `tree-sitter-python.wasm`. The packaged extension
 * calls this with the copy shipped beside its bundle; tests fall back to node_modules.
 */
export function setPythonWasmPath(path: string): void {
  wasmPath = path;
  parserPromise = null;
}

function defaultWasmPath(): string {
  // Seeded from cwd rather than import.meta.url: this module gets bundled into
  // CommonJS for the extension, and import.meta does not exist there.
  const require = createRequire(join(process.cwd(), "index.js"));
  const pkg = require.resolve("@vscode/tree-sitter-wasm/package.json");
  return join(dirname(pkg), "wasm", "tree-sitter-python.wasm");
}

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init();
      const lang = await Language.load(wasmPath ?? defaultWasmPath());
      const p = new Parser();
      p.setLanguage(lang);
      return p;
    })();
  }
  return parserPromise;
}

/** Parse Python source. Returns null if the source has any syntax error. */
export async function parsePython(source: string): Promise<Tree | null> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree || tree.rootNode.hasError) return null;
  return tree;
}
