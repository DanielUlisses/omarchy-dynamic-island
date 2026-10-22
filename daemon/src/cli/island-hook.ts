#!/usr/bin/env node
// island-hook: what Claude Code (and other agents) run on each hook event.
//
//   island-hook [--agent <name>] [<EventName>]   hook relay (event JSON on stdin)
//   island-hook --statusline                     Claude Code status line command
//   island-hook --install-hooks [--config-dir DIR]... [--no-statusline]
//   island-hook --uninstall-hooks [--config-dir DIR]...
//   island-hook --rpc <method> [<json params>]   one call to the daemon (island-ctl)
//
// Hard rule: never hold the agent up. If the island's socket is not there the
// relay gives up after CONNECT_MS and exits 0 having printed nothing, which
// Claude Code reads as "no opinion". Only a PermissionRequest waits for an
// answer, and no answer prints nothing, so the terminal asks as usual.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asObject, encode, LineSplitter, socketPath, type Decision } from "../protocol.js";
import { permissionReply, takesDecisions } from "./hookReply.js";

const CONNECT_MS = 300;
const FIRE_AND_FORGET_MS = 1500;
/** Under the 600 s Claude Code gives this hook (see claudeSettings.HOOK_EVENTS). */
const DECISION_MS = 590_000;
const MAX_FIELD = 2000;
const DIFF_TOOLS = ["Edit", "MultiEdit", "Write"];
const DIFF_FIELDS = ["old_string", "new_string", "content"];
const MAX_DIFF_FIELD = 256 * 1024;
const MAX_DIFF_TOTAL = 512 * 1024;
const DROPPED = ["tool_response", "tool_output", "transcript_path"];

function readStdin(limitMs = 3000): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(""); return; }
    let data = "";
    const t = setTimeout(() => resolve(data), limitMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => { if (data.length < 8 * 1024 * 1024) data += c; });
    process.stdin.on("end", () => { clearTimeout(t); resolve(data); });
    process.stdin.on("error", () => { clearTimeout(t); resolve(data); });
  });
}

/** A connection to the daemon, or null within CONNECT_MS. */
function connect(): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ path: socketPath() });
    const t = setTimeout(() => { sock.destroy(); resolve(null); }, CONNECT_MS);
    sock.once("connect", () => { clearTimeout(t); resolve(sock); });
    sock.once("error", () => { clearTimeout(t); resolve(null); });
  });
}

/** One request; resolves with its result, or null on any failure or after `waitMs`. */
async function call(method: string, params: unknown, waitMs: number, wantAnswer: boolean): Promise<unknown> {
  const sock = await connect();
  if (!sock) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: unknown) => { if (settled) return; settled = true; clearTimeout(t); sock.destroy(); resolve(v); };
    const t = setTimeout(() => finish(null), waitMs);
    sock.setEncoding("utf8");
    const split = new LineSplitter((line) => {
      try {
        const msg = asObject(JSON.parse(line));
        if (msg && msg.id === 1) finish(msg.error ? { __error: asObject(msg.error)?.message } : msg.result);
      } catch { /* not ours */ }
    });
    sock.on("data", (c: string) => split.push(c));
    sock.on("close", () => finish(null));
    sock.on("error", () => finish(null));
    sock.write(encode({ jsonrpc: "2.0", id: 1, method, params }), () => { if (!wantAnswer) finish(null); });
  });
}

function cut(s: string, max: number): { s: string; cut: boolean } {
  return s.length <= max ? { s, cut: false } : { s: s.slice(0, max) + "…", cut: true };
}

function capStrings(v: unknown): unknown {
  if (typeof v === "string") return cut(v, MAX_FIELD).s;
  if (Array.isArray(v)) return v.map(capStrings);
  const o = asObject(v);
  if (o) return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, capStrings(x)]));
  return v;
}

/** The edit text of a finished file tool, kept whole within its own budget. */
function capDiffInput(v: unknown, budget: { left: number; cut: boolean }): unknown {
  if (Array.isArray(v)) return v.map((x) => capDiffInput(x, budget));
  const o = asObject(v);
  if (!o) return typeof v === "string" ? cut(v, MAX_FIELD).s : v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (DIFF_FIELDS.includes(k) && typeof x === "string") {
      const r = cut(x, Math.min(MAX_DIFF_FIELD, budget.left));
      budget.left = Math.max(0, budget.left - r.s.length);
      if (r.cut) budget.cut = true;
      out[k] = r.s;
    } else out[k] = capDiffInput(x, budget);
  }
  return out;
}

function canonicalDir(dir: string | undefined): string {
  if (!dir) return "";
  const abs = path.resolve(dir).replace(/\/+$/, "");
  return abs === path.join(os.homedir(), ".claude") ? "" : abs;
}

function args(): { agent: string; event: string } {
  let agent = "", event = "";
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--agent") agent = a[++i] ?? "";
    else if (!a[i].startsWith("--") && !event) event = a[i];
  }
  return { agent, event };
}

async function relay(): Promise<void> {
  // Island Chat's own Claude Code runs: the island is already watching them.
  if (process.env.ISLAND_HOOK_DISABLE) return;
  const { agent: agentArg, event: eventArg } = args();
  const raw = (await readStdin()).replace(/^﻿/, "");
  let payload: Record<string, unknown> | null = null;
  try { payload = asObject(JSON.parse(raw)); } catch { /* nothing to forward */ }
  if (!payload) return;

  const agent = (agentArg || "claude").toLowerCase();
  const event = String(payload.hook_event_name || eventArg || "");
  const tool = String(payload.tool_name || "");
  const question = tool === "AskUserQuestion" ? asObject(payload.tool_input) ?? undefined : undefined;
  const suggestions = Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : undefined;

  for (const k of DROPPED) delete payload[k];
  const keepsDiff = event === "PostToolUse" && DIFF_TOOLS.includes(tool);
  const input = keepsDiff ? payload.tool_input : undefined;
  if (keepsDiff) delete payload.tool_input;
  const capped = capStrings(payload) as Record<string, unknown>;
  const budget = { left: MAX_DIFF_TOTAL, cut: false };
  if (keepsDiff) capped.tool_input = capDiffInput(input, budget);
  // What goes back to Claude Code must be its own input, not the shortened copy.
  if (question) capped.tool_input = question;
  // Suggestions travel whole too, since they may come back as updatedPermissions.
  if (suggestions) capped.permission_suggestions = suggestions;

  capped.hook_event_name = event;
  if (!capped.cwd) capped.cwd = process.cwd();
  capped.island = {
    agent,
    herdrPane: process.env.HERDR_PANE_ID || undefined,
    herdrSession: process.env.HERDR_SESSION || undefined,
    configDir: canonicalDir(process.env.CLAUDE_CONFIG_DIR),
    pid: process.ppid,
    diffTruncated: budget.cut || undefined,
  };

  const waits = event === "PermissionRequest" && takesDecisions(agent);
  const result = asObject(await call("hook.event", capped, waits ? DECISION_MS : FIRE_AND_FORGET_MS, waits));
  if (!waits) return;
  const decision = (result?.decision ?? null) as Decision | null;
  const line = permissionReply(agent, decision, question ?? asObject(capped.tool_input) ?? undefined, suggestions);
  if (line) process.stdout.write(line + "\n");
}

/** Runs the user's own status line command with the same input; what it prints, within 10 s. */
function runPrevious(command: string, input: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const t = setTimeout(() => { child.kill("SIGKILL"); resolve(out); }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => { if (out.length < 64 * 1024) out += c; });
    child.on("close", () => { clearTimeout(t); resolve(out); });
    child.on("error", () => { clearTimeout(t); resolve(""); });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

async function statusline(): Promise<void> {
  const raw = (await readStdin()).replace(/^﻿/, "");
  let payload: Record<string, unknown> | null = null;
  try { payload = asObject(JSON.parse(raw)); } catch { /* still run the user's line */ }
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  // Only the numbers go to the island: limits, model, cost. No cwd, no transcript.
  const sent = payload
    ? call("statusline", {
        configDir: canonicalDir(process.env.CLAUDE_CONFIG_DIR),
        session_id: payload.session_id ?? null,
        rate_limits: payload.rate_limits ?? null,
        model: payload.model ?? null,
        cost: payload.cost ?? null,
      }, CONNECT_MS + 200, false)
    : Promise.resolve(null);
  let previous = "";
  try { previous = fs.readFileSync(path.join(dir, "statusline-previous.txt"), "utf8").trim(); } catch { /* none */ }
  if (previous) process.stdout.write(await runPrevious(previous, raw));
  else if (payload) {
    const model = asObject(payload.model);
    process.stdout.write(String(model?.display_name ?? ""));
  }
  await sent;
}

async function installer(uninstall: boolean): Promise<void> {
  const { install, uninstall: remove, claudeDirs } = await import("./claudeSettings.js");
  const a = process.argv.slice(2);
  const extra: string[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] === "--config-dir" && a[i + 1]) extra.push(a[++i]);
  const self = process.env.ISLAND_HOOK_COMMAND || path.join(os.homedir(), ".local", "bin", "island-hook");
  for (const dir of claudeDirs(extra)) {
    try {
      console.log(uninstall ? remove(dir) : install(dir, self, !a.includes("--no-statusline")));
    } catch (e) {
      console.error(String((e as Error).message ?? e));
      process.exitCode = 1;
    }
  }
}

async function rpc(): Promise<void> {
  const a = process.argv.slice(2);
  const i = a.indexOf("--rpc");
  const method = a[i + 1];
  let params: unknown = {};
  if (a[i + 2]) {
    try { params = JSON.parse(a[i + 2]); } catch { console.error("params must be JSON"); process.exitCode = 2; return; }
  }
  if (!method) { console.error("usage: island-hook --rpc <method> [json]"); process.exitCode = 2; return; }
  const sock = await connect();
  if (!sock) { console.error("the island daemon is not running"); process.exitCode = 1; return; }
  sock.destroy();
  const r = await call(method, params, 15_000, true);
  const err = asObject(r)?.__error;
  if (err) { console.error(String(err)); process.exitCode = 1; return; }
  console.log(JSON.stringify(r ?? null));
}

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  if (a.includes("--statusline")) await statusline();
  else if (a.includes("--install-hooks")) await installer(false);
  else if (a.includes("--uninstall-hooks")) await installer(true);
  else if (a.includes("--rpc")) await rpc();
  else await relay();
}

// Exported for tests; only runs when executed directly.
export { capDiffInput, capStrings };

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().catch(() => undefined).finally(() => process.exit(process.exitCode ?? 0));
}
