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

export const TOOLS: IslandTool[] = [
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
