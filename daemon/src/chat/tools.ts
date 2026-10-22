// The local tools Island Chat's agent can use: look at the herdr agents and
// their panes, read what a session changed, type into a pane, open a new one,
// and apply a patch. One definition serves both chat back ends (the Agent SDK,
// as an in-process MCP server, and the Messages API tool loop).
//
// Tools that change something are `readOnly: false`; the chat asks the human
// on the island's approval card before running them.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { toUnified } from "../diff/diffEngine.js";
import type { HerdrBridge } from "../herdr/herdrBridge.js";
import type { SessionStore } from "../store/sessionStore.js";
import type { AccountManager } from "../accounts/accountManager.js";
import { listMeetings, meetingsDir } from "../meetings/meetings.js";

export interface ToolContext {
  store: SessionStore;
  herdr: HerdrBridge;
  accounts: AccountManager;
}

export interface IslandTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  readOnly: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const pane = z.string().regex(/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}$/).describe("herdr pane id, like w1:p2");
const machine = z.string().regex(/^[A-Za-z0-9_-]{0,64}$/).optional().describe("herdr machine id; omit for this machine");

function git(repo: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("git", ["-C", repo, ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? 1 : 0, out: (String(stdout) + String(stderr)).trim() }));
  });
}

const expand = (p: string): string => path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));

/** Files under `root` (depth-limited, skipping dot-directories and node_modules) with their sizes. */
function walk(root: string, recursive: boolean, out: { file: string; bytes: number; mtime: number }[], depth = 0): void {
  if (out.length >= 20_000 || depth > 8) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (recursive && !e.name.startsWith(".") && e.name !== "node_modules") walk(full, recursive, out, depth + 1);
    } else if (e.isFile()) {
      try { const st = fs.statSync(full); out.push({ file: full, bytes: st.size, mtime: st.mtimeMs }); } catch { /* vanished */ }
    }
  }
}

export const TOOLS: IslandTool[] = [
  {
    name: "files_list",
    description: "List files in a directory on this computer with their sizes, to answer questions like 'the largest files in ~/Downloads that are not PDFs'. " +
      "Filter by extension, sort by size, name or modified time. Read-only.",
    shape: {
      dir: z.string().min(1).describe("absolute directory, or ~/…"),
      recursive: z.boolean().optional().describe("include subdirectories (default false)"),
      include_ext: z.array(z.string().max(12)).max(30).optional().describe("only these extensions, e.g. ['pdf','png']"),
      exclude_ext: z.array(z.string().max(12)).max(30).optional().describe("skip these extensions"),
      sort: z.enum(["size", "name", "modified"]).optional().describe("default size, largest first"),
      limit: z.number().int().min(1).max(200).optional().describe("default 30"),
    },
    readOnly: true,
    async run(a) {
      const dir = expand(String(a.dir));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`no such directory: ${dir}`);
      const ext = (l: unknown) => new Set((Array.isArray(l) ? l : []).map((x) => String(x).replace(/^\./, "").toLowerCase()));
      const only = ext(a.include_ext), skip = ext(a.exclude_ext);
      const all: { file: string; bytes: number; mtime: number }[] = [];
      walk(dir, a.recursive === true, all);
      const rows = all.filter((f) => {
        const e = path.extname(f.file).slice(1).toLowerCase();
        return (only.size === 0 || only.has(e)) && !skip.has(e);
      });
      const by = a.sort ?? "size";
      rows.sort((x, y) => by === "name" ? x.file.localeCompare(y.file) : by === "modified" ? y.mtime - x.mtime : y.bytes - x.bytes);
      const top = rows.slice(0, Number(a.limit ?? 30));
      const mb = (b: number) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
      return `${rows.length} matching files in ${dir}${a.recursive ? " (recursive)" : ""}:\n` +
        top.map((f) => `${mb(f.bytes)}\t${f.file}`).join("\n");
    },
  },
  {
    name: "file_read",
    description: "Read a text file on this computer (cut at 40 KB; use offset to continue). Read-only.",
    shape: { file: z.string().min(1), offset: z.number().int().min(0).optional().describe("byte offset to start at") },
    readOnly: true,
    async run(a) {
      const file = expand(String(a.file));
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error(`not a file: ${file}`);
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(Math.min(40_000, Math.max(0, st.size - Number(a.offset ?? 0))));
        fs.readSync(fd, buf, 0, buf.length, Number(a.offset ?? 0));
        if (buf.includes(0)) return `${file} looks binary (${st.size} bytes).`;
        const end = Number(a.offset ?? 0) + buf.length;
        return buf.toString("utf8") + (end < st.size ? `\n[${st.size - end} more bytes; continue with offset ${end}]` : "");
      } finally { fs.closeSync(fd); }
    },
  },
  {
    name: "run_command",
    description: "Run a shell command on this computer and return its output (60 s limit). Prefer files_list / file_read for looking at files. Asks the user first.",
    shape: { command: z.string().min(1).max(4000), cwd: z.string().optional().describe("directory to run in, default home") },
    readOnly: false,
    async run(a) {
      const cwd = a.cwd ? expand(String(a.cwd)) : os.homedir();
      return await new Promise<string>((resolve) => {
        execFile("bash", ["-lc", String(a.command)], { cwd, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
          const out = (String(stdout) + String(stderr)).trim();
          resolve((err && "code" in err ? `exit ${String((err as { code?: unknown }).code)}\n` : "") + (out.length > 20_000 ? out.slice(-20_000) : out));
        });
      });
    },
  },
  {
    name: "meetings_list",
    description: "List the meetings the user transcribed on this machine (newest first): id, title, date, duration and whether it has a summary.",
    shape: {},
    readOnly: true,
    async run() {
      const rows = listMeetings().slice(0, 50);
      if (rows.length === 0) return "No meetings transcribed yet.";
      return rows.map((m) => JSON.stringify({ meeting: m.id, title: m.title, date: new Date(m.date).toISOString(), duration: m.duration, summary: m.hasSummary })).join("\n");
    },
  },
  {
    name: "meeting_read",
    description: "Read a transcribed meeting's summary (default) or full transcript, by the name meetings_list gave.",
    shape: { meeting: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/), part: z.enum(["summary", "transcript"]).optional() },
    readOnly: true,
    async run(a) {
      const file = path.join(meetingsDir(), `${String(a.meeting)}.${a.part === "transcript" ? "transcript" : "summary"}.md`);
      if (!fs.existsSync(file)) return `No ${a.part ?? "summary"} for ${a.meeting}.`;
      const text = fs.readFileSync(file, "utf8");
      return text.length > 60_000 ? text.slice(0, 60_000) + "\n[cut]" : text;
    },
  },
  {
    name: "herdr_list_sessions",
    description: "List every coding agent the island knows: herdr panes on every machine merged with Claude Code hook sessions. " +
      "Each row has its key, machine, pane, agent, status (blocked = waiting on the user, done = finished and unseen, working, idle), " +
      "title, project, the last tool it ran, its +added -removed line counts and its hook session id.",
    shape: {},
    readOnly: true,
    async run(_a, ctx) {
      const rows = ctx.store.merged().map((r) => ({
        key: r.key, machine: r.machine || "local", pane: r.pane, agent: r.agent, status: r.status, title: r.title,
        project: r.project, lastTool: r.lastTool, added: r.added, removed: r.removed, session: r.hookSession,
      }));
      const approvals = ctx.store.approvals().map((a) => ({ id: a.id, session: a.sessionId, tool: a.tool, summary: a.summary }));
      return JSON.stringify({ agents: rows, pendingApprovals: approvals }, null, 2);
    },
  },
  {
    name: "herdr_inspect_pane",
    description: "Read the recent output of a herdr pane (what is on the agent's terminal), to see why it is blocked or what it did.",
    shape: { pane, machine, lines: z.number().int().min(10).max(400).optional().describe("how many lines, default 120") },
    readOnly: true,
    async run(a, ctx) {
      return ctx.herdr.read(String(a.pane), Number(a.lines ?? 120), String(a.machine ?? ""));
    },
  },
  {
    name: "session_diffs",
    description: "The unified diffs a Claude Code session made this session (Edit / MultiEdit / Write), newest last, to summarise or review them.",
    shape: { session: z.string().min(1).describe("hook session id, from herdr_list_sessions") },
    readOnly: true,
    async run(a, ctx) {
      const diffs = ctx.store.diffs(String(a.session));
      if (diffs.length === 0) return "No file changes recorded for that session.";
      const text = diffs.map(toUnified).join("\n\n");
      return text.length > 60_000 ? text.slice(-60_000) : text;
    },
  },
  {
    name: "herdr_send_input",
    description: "Type text into a herdr pane, as if the user typed it (answer an agent, give it a follow-up). Asks the user first.",
    shape: { pane, machine, text: z.string().min(1).max(4000), submit: z.boolean().optional().describe("press Enter after, default true") },
    readOnly: false,
    async run(a, ctx) {
      await ctx.herdr.sendInput(String(a.pane), String(a.text), a.submit !== false, String(a.machine ?? ""));
      return `Sent to ${a.pane}.`;
    },
  },
  {
    name: "herdr_spawn_pane",
    description: "Open a new herdr tab in a directory and run a command there, e.g. start `claude` on a background task. " +
      "`profile` picks which configured Claude/Codex account the tab is signed in to. Asks the user first.",
    shape: {
      cwd: z.string().min(1).describe("absolute directory, or ~/…"),
      command: z.string().max(2000).describe("what to run in the new pane, e.g. claude \"fix the flaky test\""),
      label: z.string().max(40).optional(),
      profile: z.string().optional().describe("account profile id from the Claude Plans tab"),
      machine,
    },
    readOnly: false,
    async run(a, ctx) {
      const cwd = String(a.cwd).replace(/^~(?=\/|$)/, os.homedir());
      if (!path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`no such directory: ${cwd}`);
      const env = a.profile ? ctx.accounts.spawnSpec(String(a.profile)).env : {};
      const id = await ctx.herdr.spawn({ cwd, label: String(a.label ?? path.basename(cwd)), env, command: String(a.command), machine: String(a.machine ?? ""), focus: false });
      return `Started in pane ${id}.`;
    },
  },
  {
    name: "apply_git_patch",
    description: "Apply a unified diff to a git working tree with `git apply` (checked first). Asks the user first unless check_only.",
    shape: {
      repo: z.string().min(1).describe("absolute path of the repository"),
      patch: z.string().min(1).max(500_000),
      check_only: z.boolean().optional().describe("only run git apply --check"),
    },
    readOnly: false,
    async run(a) {
      const repo = String(a.repo).replace(/^~(?=\/|$)/, os.homedir());
      if (!path.isAbsolute(repo) || !fs.existsSync(path.join(repo, ".git"))) throw new Error(`${repo} is not a git repository`);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "island-patch-"));
      const file = path.join(tmp, "change.patch");
      try {
        fs.writeFileSync(file, String(a.patch).endsWith("\n") ? String(a.patch) : String(a.patch) + "\n");
        const check = await git(repo, ["apply", "--check", file]);
        if (check.code !== 0) return `git apply --check failed:\n${check.out}`;
        if (a.check_only) return "The patch applies cleanly.";
        const applied = await git(repo, ["apply", file]);
        if (applied.code !== 0) return `git apply failed:\n${applied.out}`;
        const stat = await git(repo, ["diff", "--stat"]);
        return `Applied.\n${stat.out}`;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
];

export const toolByName = (name: string): IslandTool | undefined => TOOLS.find((t) => t.name === name);

/** Checks a model-supplied input against the tool's schema. */
export function parseArgs(t: IslandTool, input: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const r = z.object(t.shape).strict().safeParse(input ?? {});
  return r.success ? { ok: true, args: r.data as Record<string, unknown> } : { ok: false, error: r.error.message };
}

export function jsonSchema(t: IslandTool): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object(t.shape).strict()) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
