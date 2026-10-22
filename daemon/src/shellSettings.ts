// The island's own settings, from its entry in Omarchy's shell.json
// (~/.config/omarchy/shell.json, "plugins": [{ "id": "omarchy-dynamic-island", ... }]).
// Read again only when the file changes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asObject } from "./protocol.js";

export const PLUGIN_ID = "omarchy-dynamic-island";

export const shellJsonPath = (): string =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "omarchy", "shell.json");

let cache: { mtime: number; entry: Record<string, unknown> } | null = null;

export function islandSettings(): Record<string, unknown> {
  const file = shellJsonPath();
  let mtime = -1;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return {}; }
  if (cache && cache.mtime === mtime) return cache.entry;
  let entry: Record<string, unknown> = {};
  try {
    const plugins = asObject(JSON.parse(fs.readFileSync(file, "utf8")))?.plugins;
    const found = Array.isArray(plugins) ? plugins.map(asObject).find((p) => p?.id === PLUGIN_ID) : null;
    entry = found ?? {};
  } catch {
    // Mid-edit or broken: keep what we had.
    return cache?.entry ?? {};
  }
  cache = { mtime, entry };
  return entry;
}
