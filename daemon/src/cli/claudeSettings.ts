// Putting island-hook into Claude Code's settings.json and taking it out
// again, without disturbing anything else in there. Pure functions over the
// parsed settings, plus the file plumbing (backup, atomic write) around them.
//
// Every hook entry the island owns runs a command containing "island-hook",
// which is how a later install or uninstall finds them. The user's own status
// line is kept: its command is saved beside the settings
// (statusline-previous.txt) and island-hook --statusline runs it for them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asObject, asString } from "../protocol.js";

export const MARK = "island-hook";

/** Events the island listens to, and how long Claude Code may wait on each (seconds). */
export const HOOK_EVENTS: { event: string; matcher?: string; timeout: number }[] = [
  { event: "SessionStart", timeout: 5 },
  { event: "SessionEnd", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 5 },
  { event: "PreToolUse", matcher: "*", timeout: 5 },
  { event: "PostToolUse", matcher: "*", timeout: 5 },
  // Held open while the island waits on a human; the terminal prompt takes
  // over if nobody answers in time.
  { event: "PermissionRequest", matcher: "*", timeout: 600 },
  { event: "Notification", timeout: 5 },
  { event: "Stop", timeout: 5 },
];

type Json = Record<string, unknown>;

const isOurs = (h: unknown): boolean => asString(asObject(h)?.command).includes(MARK);

/** Settings with every island hook removed (and emptied groups dropped). */
export function withoutHooks(settings: Json): Json {
  const next: Json = { ...settings };
  const hooks = asObject(next.hooks);
  if (!hooks) return next;
  const cleaned: Json = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) { cleaned[event] = groups; continue; }
    const kept = groups.map((g) => {
      const group = asObject(g);
      if (!group || !Array.isArray(group.hooks)) return g;
      return { ...group, hooks: group.hooks.filter((h) => !isOurs(h)) };
    }).filter((g) => {
      const group = asObject(g);
      return !group || !Array.isArray(group.hooks) || group.hooks.length > 0;
    });
    if (kept.length > 0) cleaned[event] = kept;
  }
  if (Object.keys(cleaned).length > 0) next.hooks = cleaned;
  else delete next.hooks;
  return next;
}

/** Settings with the island's hooks in place, exactly once each. */
export function withHooks(settings: Json, command: string): Json {
  const next = withoutHooks(settings);
  const hooks: Json = { ...(asObject(next.hooks) ?? {}) };
  for (const { event, matcher, timeout } of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout }] });
    hooks[event] = groups;
  }
  next.hooks = hooks;
  return next;
}

/** The status line command the user had, unless it is already ours. */
export function previousStatusLine(settings: Json): string | null {
  const cmd = asString(asObject(settings.statusLine)?.command);
  return cmd && !cmd.includes(MARK) ? cmd : null;
}

export function withStatusLine(settings: Json, command: string): Json {
  const prev = asObject(settings.statusLine) ?? {};
  return { ...settings, statusLine: { ...prev, type: "command", command } };
}

/** Back to the user's own status line, or none. */
export function withoutStatusLine(settings: Json, previous: string | null): Json {
  const next = { ...settings };
  const cur = asObject(next.statusLine);
  if (!cur || !asString(cur.command).includes(MARK)) return next;
  if (previous) next.statusLine = { ...cur, command: previous };
  else delete next.statusLine;
  return next;
}

// ---- files

export function claudeDirs(extra: string[]): string[] {
  const dirs = [process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), ...extra];
  return [...new Set(dirs.map((d) => path.resolve(d.replace(/^~(?=\/|$)/, os.homedir()))))];
}

function readSettings(file: string): Json {
  try {
    return asObject(JSON.parse(fs.readFileSync(file, "utf8"))) ?? {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    // Never overwrite a settings file we cannot read.
    throw new Error(`${file} is not valid JSON; fix it first, nothing was changed`);
  }
}

function writeSettings(file: string, before: Json, after: Json): boolean {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(file, `${file}.island-backup-${stamp}`);
  }
  const tmp = `${file}.island-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(after, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return true;
}

export const previousFile = (dir: string): string => path.join(dir, "statusline-previous.txt");

/** Installs into one Claude config dir. Returns what changed, for the installer to print. */
export function install(dir: string, hookCommand: string, statusline: boolean): string {
  const file = path.join(dir, "settings.json");
  const before = readSettings(file);
  let after = withHooks(before, hookCommand);
  if (statusline) {
    const prev = previousStatusLine(before);
    if (prev) fs.writeFileSync(previousFile(dir), prev + "\n");
    after = withStatusLine(after, `${hookCommand} --statusline`);
  }
  return writeSettings(file, before, after) ? `updated ${file} (backup kept beside it)` : `${file} already set up`;
}

export function uninstall(dir: string): string {
  const file = path.join(dir, "settings.json");
  if (!fs.existsSync(file)) return `${file}: nothing to do`;
  const before = readSettings(file);
  let previous: string | null = null;
  try { previous = fs.readFileSync(previousFile(dir), "utf8").trim() || null; } catch { /* none */ }
  const after = withoutStatusLine(withoutHooks(before), previous);
  const changed = writeSettings(file, before, after);
  fs.rmSync(previousFile(dir), { force: true });
  return changed ? `restored ${file}` : `${file}: nothing to do`;
}
