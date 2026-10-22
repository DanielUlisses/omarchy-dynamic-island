// One store for every coding agent the island knows about: the ones herdr
// sees in its panes, and the Claude Code (or other) sessions that report
// through island-hook. A hook session started inside herdr carries its pane
// id (HERDR_PANE_ID), so the two are merged into one row: herdr says where it
// runs and whether it is waiting, the hooks say what it is doing, what it
// changed and what it is asking.
//
// The store also holds the permission requests and questions waiting on a
// human, from hooks and from Island Chat alike; each one resolves the promise
// its asker is waiting on.

import { EventEmitter } from "node:events";
import path from "node:path";
import { canonicalConfigDir } from "../accounts/accountManager.js";
import { fromToolInput, type FileDiff } from "../diff/diffEngine.js";
import type { HerdrAgent } from "../herdr/herdrBridge.js";
import { asObject, asString, type Decision, type HookEvent } from "../protocol.js";

export type SessionStatus = "working" | "blocked" | "idle" | "done";

export interface Session {
  id: string;
  agent: string;
  cwd: string;
  project: string;
  herdrPane: string;
  herdrSession: string;
  configDir: string;
  status: SessionStatus;
  lastTool: string;
  lastPrompt: string;
  message: string;
  startedAt: number;
  updatedAt: number;
  added: number;
  removed: number;
  diffs: FileDiff[];
}

export interface QuestionOption { label: string; description?: string }
export interface Question { question: string; header?: string; options: QuestionOption[]; multiSelect: boolean }

export interface Approval {
  id: string;
  /** "hook" for Claude Code sessions, "chat" for Island Chat's own tools. */
  source: "hook" | "chat";
  sessionId: string;
  agent: string;
  project: string;
  herdrPane: string;
  tool: string;
  summary: string;
  detail: string;
  questions: Question[];
  canAlwaysAllow: boolean;
  createdAt: number;
}

export const MAX_DIFFS_PER_SESSION = 50;
const SESSION_TTL_MS = 6 * 3600_000;

/** Agent accent colours, also used by the island when a session is working. */
export const AGENT_COLORS: Record<string, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  gemini: "#4285f4",
  cursor: "#c4b5fd",
  "pi-agent": "#22d3ee",
  pi: "#22d3ee",
  opencode: "#f59e0b",
  island: "#7aa2f7",
};

/** One line saying what a tool is about to do: the command, the file, the query. */
export function toolSummary(tool: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const pick = (...keys: string[]) => keys.map((k) => asString(i[k])).find((v) => v) ?? "";
  let s: string;
  if (tool === "Bash") s = pick("command");
  else if (["Edit", "MultiEdit", "Write", "Read", "NotebookEdit"].includes(tool)) s = path.basename(pick("file_path", "notebook_path", "path"));
  else if (tool === "Grep" || tool === "Glob") s = pick("pattern");
  else if (tool === "WebFetch") s = pick("url");
  else if (tool === "WebSearch") s = pick("query");
  else if (tool === "Task" || tool === "Agent") s = pick("description", "prompt");
  else s = pick("description", "command", "file_path", "url", "query", "pane", "text") || JSON.stringify(i);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 160 ? s.slice(0, 159) + "…" : s;
}

function questionsOf(input: Record<string, unknown> | undefined): Question[] {
  const list = Array.isArray(input?.questions) ? input!.questions : [];
  return list.map((q) => {
    const o = asObject(q) ?? {};
    const options = (Array.isArray(o.options) ? o.options : []).map((x) => {
      const opt = asObject(x) ?? {};
      return { label: asString(opt.label), description: asString(opt.description) || undefined };
    }).filter((x) => x.label);
    return { question: asString(o.question), header: asString(o.header) || undefined, options, multiSelect: o.multiSelect === true };
  }).filter((q) => q.question && q.options.length > 0);
}

/** True when `answers` answers exactly the questions asked, with labels that were offered. */
export function answersFit(questions: Question[], answers: Record<string, string | string[]>): boolean {
  if (questions.length === 0 || Object.keys(answers).length !== questions.length) return false;
  return questions.every((q) => {
    const a = answers[q.question];
    const labels = q.options.map((o) => o.label);
    if (!q.multiSelect) return typeof a === "string" && labels.includes(a);
    return Array.isArray(a) && a.length > 0 && new Set(a).size === a.length && a.every((x) => labels.includes(x));
  });
}

interface Pending { approval: Approval; resolve: (d: Decision | null) => void }

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>();
  private pending = new Map<string, Pending>();
  /** session id -> tool names allowed for the rest of that session. */
  private alwaysAllow = new Map<string, Set<string>>();
  private herdr: HerdrAgent[] = [];
  private nextDiffId = 1;
  private nextApprovalId = 1;

  private changed(): void { this.emit("change"); }

  setHerdr(agents: HerdrAgent[]): void {
    this.herdr = agents;
    this.changed();
  }

  get herdrAgents(): HerdrAgent[] { return this.herdr; }

  session(id: string): Session | undefined { return this.sessions.get(id); }

  private ensure(ev: HookEvent): Session {
    const id = ev.session_id || `anon-${ev.island.pid ?? 0}`;
    let s = this.sessions.get(id);
    const cwd = ev.cwd || s?.cwd || "";
    if (!s) {
      s = {
        id, agent: ev.island.agent || "claude", cwd, project: path.basename(cwd).split("--")[0],
        herdrPane: ev.island.herdrPane ?? "", herdrSession: ev.island.herdrSession ?? "",
        configDir: ev.island.configDir ?? "", status: "idle", lastTool: "", lastPrompt: "", message: "",
        startedAt: Date.now(), updatedAt: Date.now(), added: 0, removed: 0, diffs: [],
      };
      this.sessions.set(id, s);
    }
    if (ev.island.herdrPane) s.herdrPane = ev.island.herdrPane;
    if (cwd && cwd !== s.cwd) { s.cwd = cwd; s.project = path.basename(cwd).split("--")[0]; }
    s.updatedAt = Date.now();
    return s;
  }

  /** A fire-and-forget hook event. Returns the session it touched. */
  ingest(ev: HookEvent): Session | null {
    const name = ev.hook_event_name;
    if (name === "SessionEnd") {
      if (ev.session_id) {
        this.sessions.delete(ev.session_id);
        this.alwaysAllow.delete(ev.session_id);
        for (const [id, p] of this.pending) if (p.approval.sessionId === ev.session_id) this.cancel(id);
      }
      this.changed();
      return null;
    }
    const s = this.ensure(ev);
    switch (name) {
      case "SessionStart":
        s.status = "idle";
        break;
      case "UserPromptSubmit":
        s.status = "working";
        s.lastPrompt = asString(ev.prompt).slice(0, 300);
        s.message = "";
        break;
      case "PreToolUse":
        s.status = "working";
        s.lastTool = `${ev.tool_name ?? ""} ${toolSummary(ev.tool_name ?? "", ev.tool_input)}`.trim();
        break;
      case "PostToolUse": {
        s.status = "working";
        const d = ev.island.diffTruncated ? null : fromToolInput(ev.tool_name ?? "", ev.tool_input);
        if (d && (d.added > 0 || d.removed > 0)) this.addDiff(s, { ...d, id: this.nextDiffId++, tool: ev.tool_name ?? "", at: Date.now() });
        break;
      }
      case "Notification": {
        const msg = asString(ev.message);
        s.message = msg.slice(0, 300);
        // "Claude needs your permission to use Bash" vs "Claude is waiting for your input".
        s.status = /permission|approv/i.test(msg) ? "blocked" : "idle";
        break;
      }
      case "Stop":
      case "SubagentStop":
        if (name === "Stop") s.status = "done";
        break;
      default:
        break;
    }
    this.prune();
    this.changed();
    return s;
  }

  private addDiff(s: Session, d: FileDiff): void {
    s.diffs.push(d);
    if (s.diffs.length > MAX_DIFFS_PER_SESSION) s.diffs.splice(0, s.diffs.length - MAX_DIFFS_PER_SESSION);
    s.added += d.added;
    s.removed += d.removed;
  }

  /** Marks a finished session as looked at (the island opened it). */
  markSeen(id: string): void {
    const s = this.sessions.get(id);
    if (s && s.status === "done") { s.status = "idle"; this.changed(); }
  }

  clearDiffs(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.diffs = []; s.added = 0; s.removed = 0;
    this.changed();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions)
      if (now - s.updatedAt > SESSION_TTL_MS && ![...this.pending.values()].some((p) => p.approval.sessionId === id))
        this.sessions.delete(id);
  }

  // ---- approvals

  isAlwaysAllowed(sessionId: string, tool: string): boolean {
    return this.alwaysAllow.get(sessionId)?.has(tool) ?? false;
  }

  /**
   * Puts a permission request (or AskUserQuestion) in front of the human and
   * resolves with their decision, or null when it was withdrawn (the asker
   * hung up, or answered in its own terminal).
   */
  requestApproval(req: {
    source: "hook" | "chat"; sessionId: string; agent: string; project: string; herdrPane: string;
    tool: string; input: Record<string, unknown> | undefined; canAlwaysAllow?: boolean;
  }): { id: string; decision: Promise<Decision | null> } {
    const id = `ap${this.nextApprovalId++}`;
    const questions = req.tool === "AskUserQuestion" ? questionsOf(req.input) : [];
    const detail = req.tool === "Bash" ? asString(req.input?.command)
      : req.tool === "Edit" ? asString(req.input?.new_string)
      : JSON.stringify(req.input ?? {}, null, 2);
    const approval: Approval = {
      id, source: req.source, sessionId: req.sessionId, agent: req.agent, project: req.project,
      herdrPane: req.herdrPane, tool: req.tool, summary: toolSummary(req.tool, req.input),
      detail: detail.length > 4000 ? detail.slice(0, 3999) + "…" : detail,
      questions, canAlwaysAllow: req.canAlwaysAllow !== false && questions.length === 0, createdAt: Date.now(),
    };
    const s = this.sessions.get(req.sessionId);
    if (s) { s.status = "blocked"; s.message = `Wants to use ${req.tool}`; }
    const decision = new Promise<Decision | null>((resolve) => this.pending.set(id, { approval, resolve }));
    this.changed();
    return { id, decision };
  }

  /** The human's answer. False when nothing is waiting under that id, or the answer does not fit. */
  decide(id: string, d: Decision): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    if (d.kind === "answer" && !answersFit(p.approval.questions, d.answers)) return false;
    if (d.kind === "always_allow") {
      const set = this.alwaysAllow.get(p.approval.sessionId) ?? new Set<string>();
      set.add(p.approval.tool);
      this.alwaysAllow.set(p.approval.sessionId, set);
    }
    this.pending.delete(id);
    const s = this.sessions.get(p.approval.sessionId);
    if (s) { s.status = d.kind === "deny" ? "idle" : "working"; s.message = ""; }
    p.resolve(d);
    this.changed();
    return true;
  }

  cancel(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(null);
    this.changed();
  }

  approvals(): Approval[] {
    return [...this.pending.values()].map((p) => p.approval).sort((a, b) => a.createdAt - b.createdAt);
  }

  approval(id: string): Approval | undefined { return this.pending.get(id)?.approval; }

  // ---- views

  /**
   * herdr's agents with the hook session in each pane folded in, then the hook
   * sessions herdr does not know (started outside it). Most urgent first.
   */
  merged(): MergedAgent[] {
    const out: MergedAgent[] = [];
    const used = new Set<string>();
    const blockedSessions = new Set(this.approvals().map((a) => a.sessionId));
    for (const h of this.herdr) {
      const s = h.machine === "" ? [...this.sessions.values()].find((x) => x.herdrPane === h.pane) : undefined;
      if (s) used.add(s.id);
      out.push(row(h.key, h, s, blockedSessions));
    }
    for (const s of this.sessions.values()) if (!used.has(s.id)) out.push(row("hook/" + s.id, null, s, blockedSessions));
    const rank: Record<string, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
    return out.sort((a, b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || a.place.localeCompare(b.place));
  }

  diffs(sessionId: string): FileDiff[] { return this.sessions.get(sessionId)?.diffs ?? []; }

  diff(id: number): FileDiff | undefined {
    for (const s of this.sessions.values()) { const d = s.diffs.find((x) => x.id === id); if (d) return d; }
    return undefined;
  }

  sessionsByConfigDir(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const s of this.sessions.values()) if (s.status !== "idle" || Date.now() - s.updatedAt < 3600_000) {
      const k = canonicalConfigDir(s.configDir);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }
}

export interface MergedAgent {
  key: string;
  machine: string;
  target: string;
  session: string;
  label: string;
  pane: string;
  agent: string;
  status: string;
  title: string;
  project: string;
  place: string;
  color: string;
  hookSession: string;
  lastTool: string;
  lastPrompt: string;
  added: number;
  removed: number;
  diffCount: number;
  configDir: string;
}

function row(key: string, h: HerdrAgent | null, s: Session | undefined, blocked: Set<string>): MergedAgent {
  const agent = (s?.agent || h?.agent || "claude").toLowerCase();
  // A pending approval is the most certain "needs you" there is; herdr's
  // own reading of the screen comes next, then what the hooks last said.
  let status = h?.status ?? s?.status ?? "unknown";
  if (s && blocked.has(s.id)) status = "blocked";
  else if (s && !h) status = s.status;
  else if (s && h && (h.status === "unknown" || h.status === "idle") && s.status === "working") status = "working";
  const project = h?.project || s?.project || "";
  return {
    key,
    machine: h?.machine ?? "", target: h?.target ?? "", session: h?.session ?? "default", label: h?.label ?? "",
    pane: h?.pane ?? s?.herdrPane ?? "", agent, status,
    title: h?.title || s?.lastPrompt || "",
    project, place: [h?.label, project].filter(Boolean).join(" · "),
    color: AGENT_COLORS[agent] ?? AGENT_COLORS.claude,
    hookSession: s?.id ?? "", lastTool: s?.lastTool ?? "", lastPrompt: s?.lastPrompt ?? "",
    added: s?.added ?? 0, removed: s?.removed ?? 0, diffCount: s?.diffs.length ?? 0, configDir: s?.configDir ?? "",
  };
}
