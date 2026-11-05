// IslandModel.js (the island's pure QML helpers) loaded into a sandbox, so its
// functions can be tested here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> the repo root
const file = path.resolve(here, "..", "..", "..", "IslandModel.js");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function islandModel(): Record<string, (...args: any[]) => any> {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(file, "utf8").replace(/^\.pragma .*$/m, ""), ctx, { filename: file });
  return ctx as never;
}
