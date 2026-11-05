// tk-hub (the developer's dashboard for the agents on his devboxes): the
// island asks it for one small answer, GET {hubUrl}/api/desktop, every
// `hubInterval` seconds (10), with a `desktop` token. That answer holds the
// devbox agents, the first moves of Today, and the hub's meetings for today
// and tomorrow.
//
// The agents come out in the same shape as herdr's (HerdrAgent), so the
// island's rows, bubble and toasts take them as they are; a hub row carries
// `source: "hub"`, its ticket page `url`, and the agent's dialog while it is
// blocked. When the hub doesn't answer, the last answer is kept and the
// island says how long the hub has been offline.
//
// The token lives in ~/.config/omarchy-dynamic-island/hub-token (0600), never
// in shell.json or the repo.

import fs from "node:fs";
import path from "node:path";
import type { HerdrAgent } from "../herdr/herdrBridge.js";
import { asObject, asString, configDir, isNum } from "../protocol.js";

export const DEFAULT_INTERVAL_S = 10;
const TIMEOUT_MS = 8000;

export interface HubSettings {
  /** "" when the hub is not set up. */
  url: string;
  intervalMs: number;
  /** Whether the island's own herdr polling stays on. */
  herdrOn: boolean;
}

/**
 * The hub's settings from the island's shell.json entry. `herdr` is `"auto"`
 * by default: on without a hub, off with one. `true` or `false` wins.
 */
export function hubSettings(entry: Record<string, unknown>): HubSettings {
  const url = cleanBase(entry.hubUrl);
  const secs = Number(entry.hubInterval ?? DEFAULT_INTERVAL_S);
  const herdr = entry.herdr;
  return {
    url,
    intervalMs: Math.max(5, Number.isFinite(secs) ? secs : DEFAULT_INTERVAL_S) * 1000,
    herdrOn: herdr === false ? false : herdr === true ? true : url === "",
  };
}

/** "https://host[:port]" with no trailing slash, or "" when it is not an http(s) link. */
export function cleanBase(value: unknown): string {
  const s = asString(value).trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password) return "";
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const PATH_RE = /^\/api\/[A-Za-z0-9_\-./%]{1,200}$/;

/** A hub route the island may call: under /api/, no way back up, nothing but the path. */
export function validPath(p: unknown): p is string {
  return typeof p === "string" && PATH_RE.test(p) && !p.split("/").includes("..");
}

/**
 * A page of the hub to open: the hub's own link when it is on the configured
 * hub, else the same page (its #/ route) on the configured hub.
 */
export function pageUrl(base: string, link: unknown, fallbackHash = ""): string {
  if (!base) return "";
  const raw = asString(link).trim();
  let hash = fallbackHash;
  if (raw) {
    try {
      const u = new URL(raw, base + "/");
      if (u.origin === new URL(base).origin && (u.protocol === "https:" || u.protocol === "http:")) return u.href;
      hash = u.hash || hash;
    } catch { /* fall back */ }
  }
  hash = hash.replace(/[^A-Za-z0-9_\-./#%~]/g, "");
  return base + "/" + (hash.startsWith("#") ? hash : hash ? "#" + hash : "");
}

export interface HubAction { label: string; method: "GET" | "POST"; path: string }

export interface HubMove {
  id: string;
  kind: string;
  rank: string;
  title: string;
  client: string;
  detail: string;
  action: HubAction | null;
  later: HubAction | null;
  url: string;
}

export interface HubMeeting {
  id: number;
  uid: string;
  start: number;
  end: number;
  title: string;
  capture: boolean;
  project: string;
}

export interface HubDialog { question: string; text: string; options: string[] }

/** A devbox agent from the hub, in herdr's shape plus what only the hub knows. */
export interface HubAgent extends HerdrAgent {
  source: "hub";
  url: string;
  devbox: string;
  board: string;
  boardKey: string;
  nn: string;
  client: string;
  col: string;
  ask: { why: string; title: string } | null;
  dialog: HubDialog | null;
  since: number;
}

export interface Desktop {
  at: number;
  counts: { needs: number; review: number; working: number };
  agents: HubAgent[];
  moves: HubMove[];
  meetings: HubMeeting[];
}

const STATUSES = new Set(["blocked", "done", "working", "idle", "gone"]);
const clip = (v: unknown, n: number): string => {
  const s = asString(v).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const time = (v: unknown): number => {
  const t = Date.parse(asString(v));
  return Number.isFinite(t) ? t : 0;
};
const count = (v: unknown): number => (isNum(v) && v >= 0 ? Math.floor(v) : 0);

function action(v: unknown): HubAction | null {
  const o = asObject(v);
  if (!o) return null;
  const method = asString(o.method).toUpperCase();
  if ((method !== "POST" && method !== "GET") || !validPath(o.path)) return null;
  return { label: clip(o.label, 24) || (method === "GET" ? "Open" : "Do it"), method, path: o.path };
}

function dialog(v: unknown): HubDialog | null {
  const o = asObject(v);
  if (!o) return null;
  const options = (Array.isArray(o.options) ? o.options : []).map((x) => clip(x, 80)).filter(Boolean).slice(0, 6);
  const d = { question: clip(o.question, 300), text: asString(o.text).slice(0, 2000), options };
  return d.question || d.text || options.length ? d : null;
}

/** GET /api/desktop's answer -> what the island shows. Anything malformed is left out, never thrown. */
export function parseDesktop(raw: unknown, base: string): Desktop {
  const o = asObject(raw) ?? {};
  const c = asObject(o.counts) ?? {};
  const agents: HubAgent[] = [];
  for (const item of Array.isArray(o.agents) ? o.agents : []) {
    const a = asObject(item);
    if (!a) continue;
    const key = clip(a.key, 200);
    if (!key) continue;
    const status = asString(a.status);
    const board = clip(a.board, 80);
    const boardKey = asString(a.board_key).slice(0, 200);
    const nn = clip(a.nn, 8);
    const devbox = clip(a.devbox, 64);
    const client = clip(a.client, 64);
    const ask = asObject(a.ask);
    const fallback = boardKey && nn ? `#/ticket/${encodeURIComponent(boardKey)}/${encodeURIComponent(nn)}` : "";
    agents.push({
      key: "hub/" + key,
      machine: devbox, target: "", session: "default", label: client || devbox, pane: "",
      agent: "claude",
      status: STATUSES.has(status) ? status : "unknown",
      title: clip(a.title, 200) || (nn ? `#${nn}` : key),
      project: board, cwd: "",
      source: "hub",
      url: pageUrl(base, a.url, fallback),
      devbox, board, boardKey, nn, client,
      col: clip(a.col, 24),
      ask: ask ? { why: clip(ask.why, 40), title: clip(ask.title, 200) } : null,
      dialog: dialog(a.dialog),
      since: time(a.since),
    });
  }
  const moves: HubMove[] = [];
  for (const item of Array.isArray(o.moves) ? o.moves : []) {
    const m = asObject(item);
    if (!m) continue;
    const id = clip(m.id, 80);
    const title = clip(m.title, 200);
    if (!id || !title) continue;
    moves.push({
      id, kind: clip(m.kind, 24), rank: clip(m.rank, 24), title,
      client: clip(m.client, 64), detail: clip(m.detail, 200),
      action: action(m.action), later: action(m.later),
      url: pageUrl(base, m.url, "#/today"),
    });
  }
  const meetings: HubMeeting[] = [];
  for (const item of Array.isArray(o.meetings) ? o.meetings : []) {
    const m = asObject(item);
    if (!m || !isNum(m.id)) continue;
    const start = time(m.start_at);
    if (!start) continue;
    meetings.push({
      id: m.id, uid: asString(m.uid).trim().slice(0, 400), start, end: time(m.end_at) || start,
      title: clip(m.title, 200), capture: m.capture === true, project: clip(m.project, 80),
    });
  }
  return {
    at: time(o.at) || Date.now(),
    counts: { needs: count(c.needs), review: count(c.review), working: count(c.working) },
    agents, moves: moves.slice(0, 3), meetings,
  };
}

export const tokenPath = (): string => path.join(configDir(), "hub-token");

/** The desktop token, or why there is none. Refused when others can read the file. */
export function readToken(file = tokenPath()): { token: string; error: string } {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return { token: "", error: `no token in ${file}` }; }
  if ((st.mode & 0o077) !== 0) return { token: "", error: `${file} is readable by others: chmod 600 it` };
  const token = fs.readFileSync(file, "utf8").trim();
  if (!token || /\s/.test(token)) return { token: "", error: `${file} holds no token` };
  return { token, error: "" };
}

export interface HubState {
  configured: boolean;
  url: string;
  online: boolean;
  /** Epoch ms of the last answer, 0 for never. */
  lastOkAt: number;
  error: string;
  counts: Desktop["counts"];
  moves: HubMove[];
  meetings: HubMeeting[];
}

type Fetch = typeof fetch;

export interface HubDeps {
  settings: () => HubSettings;
  token?: () => { token: string; error: string };
  fetch?: Fetch;
  now?: () => number;
}

export class HubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class HubBridge {
  agents: HubAgent[] = [];
  private desktop: Desktop | null = null;
  private online = false;
  private lastOkAt = 0;
  private error = "";
  private base = "";
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastPoll = 0;

  constructor(private readonly onChange: () => void, private readonly deps: HubDeps) {}

  private get fetchImpl(): Fetch { return this.deps.fetch ?? fetch; }
  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** Ticks every second; polls when `hubInterval` has passed, so a changed setting applies at once. */
  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const s = this.deps.settings();
    if (s.url !== this.base) {
      // Set up, moved or turned off: start over.
      this.base = s.url;
      this.reset();
      this.lastPoll = 0;
    }
    if (!s.url || this.now() - this.lastPoll < s.intervalMs) return;
    await this.poll();
  }

  private reset(): void {
    this.agents = [];
    this.desktop = null;
    this.online = false;
    this.lastOkAt = 0;
    this.error = "";
    this.onChange();
  }

  get configured(): boolean { return this.base !== ""; }

  private auth(): string {
    const t = (this.deps.token ?? readToken)();
    if (!t.token) throw new HubError(0, t.error);
    return t.token;
  }

  private async request(method: "GET" | "POST", route: string, body: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.base) throw new HubError(0, "the hub is not set up (hubUrl)");
    if (!validPath(route)) throw new HubError(0, "not a hub route");
    const token = this.auth();
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + route, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new HubError(0, `hub unreachable: ${(e as Error).message || e}`);
    }
    const text = await res.text().catch(() => "");
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const detail = asObject(data)?.detail;
      throw new HubError(res.status, `hub said ${res.status}${typeof detail === "string" ? ": " + detail : ""}`);
    }
    return data;
  }

  async poll(): Promise<void> {
    if (this.polling || !this.base) return;
    this.polling = true;
    this.lastPoll = this.now();
    const base = this.base;
    try {
      const data = await this.request("GET", "/api/desktop", undefined, TIMEOUT_MS);
      if (base !== this.base) return;
      this.desktop = parseDesktop(data, base);
      this.agents = this.desktop.agents;
      this.online = true;
      this.lastOkAt = this.now();
      this.error = "";
    } catch (e) {
      if (base !== this.base) return;
      // Offline: keep the last list, say since when.
      this.online = false;
      this.error = (e as Error).message || String(e);
    } finally {
      this.polling = false;
    }
    this.onChange();
  }

  /**
   * Runs a move's action or its Later: only the method and path the hub gave
   * for that move in its last answer, so the island can't be made to call
   * any other route. Polls again after, so Today's next move shows.
   */
  async runMove(id: string, which: "action" | "later"): Promise<unknown> {
    const move = this.desktop?.moves.find((m) => m.id === id);
    if (!move) throw new HubError(0, "that move is no longer on Today");
    const act = move[which];
    if (!act) throw new HubError(0, which === "later" ? "this move can't be set aside" : "this move only opens");
    try {
      return await this.request(act.method, act.path, act.method === "POST" ? {} : undefined, TIMEOUT_MS);
    } finally {
      this.lastPoll = 0;
      void this.poll();
    }
  }

  snapshot(): HubState {
    return {
      configured: this.configured,
      url: this.base,
      online: this.online,
      lastOkAt: this.lastOkAt,
      error: this.error,
      counts: this.desktop?.counts ?? { needs: 0, review: 0, working: 0 },
      moves: this.desktop?.moves ?? [],
      meetings: this.desktop?.meetings ?? [],
    };
  }
}
