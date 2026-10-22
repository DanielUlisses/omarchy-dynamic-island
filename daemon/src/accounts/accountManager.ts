// The accounts the island watches, in ~/.config/omarchy-dynamic-island/accounts.json:
// several Claude Pro/Max logins (each its own CLAUDE_CONFIG_DIR), Anthropic API
// keys, Codex logins (CODEX_HOME) and a local Ollama. For each one the island
// shows its 5-hour and weekly usage, can make it the default for new shells,
// and can open a herdr tab already signed in to it.
//
// Nothing here reads anyone's credentials. Claude numbers arrive through
// Claude Code's own status line (island-hook --statusline), Codex numbers
// from the Codex CLI (`codex app-server`), Ollama from its local HTTP API.
// API keys are referenced, never stored: an env var name or a command such as
// `op read op://…` that prints the key at the moment it is needed.

import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asObject, asString, configDir, isNum, stateDir } from "../protocol.js";
import { mergeSdkRateLimit, parseClaudeRateLimits, parseCodexRateLimits, type PlanUsage } from "./planMath.js";

export type ProfileKind = "claude" | "anthropic-api" | "codex" | "ollama";

export interface Profile {
  id: string;
  label: string;
  kind: ProfileKind;
  /** claude: its CLAUDE_CONFIG_DIR ("" or absent: ~/.claude). */
  configDir?: string;
  /** codex: its CODEX_HOME ("" or absent: ~/.codex). */
  codexHome?: string;
  /** anthropic-api: where the key comes from. */
  apiKeyEnv?: string;
  apiKeyCommand?: string;
  /** ollama: default http://127.0.0.1:11434. */
  baseUrl?: string;
  models?: string[];
  defaultModel?: string;
  color?: string;
}

export interface AccountsFile {
  version: 1;
  active: string;
  profiles: Profile[];
  /** Where the secretary repo is checked out, for Island Chat's Secretary workspace. */
  secretaryPath?: string;
  /** Directory new herdr tabs open in (default ~). */
  spawnCwd?: string;
}

export interface ProfileStatus {
  usage?: PlanUsage;
  model?: string;
  costUsd?: number;
  health: "ok" | "error" | "unknown";
  detail: string;
  checkedAt: number;
}

export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"];

const ID_RE = /^[A-Za-z0-9_.-]{1,48}$/;

export const accountsPath = (): string => path.join(configDir(), "accounts.json");
const usagePath = (): string => path.join(stateDir(), "usage.json");
export const activeEnvPath = (): string => path.join(configDir(), "active-profile.env");

function expandHome(p: string): string {
  return p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** A Claude config dir in one canonical form, "" for the default ~/.claude. */
export function canonicalConfigDir(dir: string | undefined): string {
  if (!dir) return "";
  const abs = path.resolve(expandHome(dir)).replace(/\/+$/, "");
  return abs === path.join(os.homedir(), ".claude") ? "" : abs;
}

export function defaultAccounts(): AccountsFile {
  return {
    version: 1,
    active: "claude",
    profiles: [
      { id: "claude", label: "Claude", kind: "claude", configDir: "", models: CLAUDE_MODELS, defaultModel: "claude-opus-5-5" },
      { id: "ollama", label: "Ollama", kind: "ollama", baseUrl: "http://127.0.0.1:11434" },
    ],
    secretaryPath: "~/secretary",
  };
}

/** accounts.json, checked: unknown kinds and bad ids are dropped, never fatal. */
export function parseAccounts(text: string): AccountsFile {
  const raw = asObject(JSON.parse(text)) ?? {};
  const profiles: Profile[] = [];
  for (const p of Array.isArray(raw.profiles) ? raw.profiles : []) {
    const o = asObject(p);
    if (!o) continue;
    const id = asString(o.id), kind = asString(o.kind) as ProfileKind;
    if (!ID_RE.test(id) || !["claude", "anthropic-api", "codex", "ollama"].includes(kind)) continue;
    if (profiles.some((x) => x.id === id)) continue;
    profiles.push({
      id, kind, label: asString(o.label) || id,
      configDir: asString(o.configDir) || undefined,
      codexHome: asString(o.codexHome) || undefined,
      apiKeyEnv: asString(o.apiKeyEnv) || undefined,
      apiKeyCommand: asString(o.apiKeyCommand) || undefined,
      baseUrl: asString(o.baseUrl) || undefined,
      models: Array.isArray(o.models) ? o.models.filter((m): m is string => typeof m === "string") : undefined,
      defaultModel: asString(o.defaultModel) || undefined,
      color: asString(o.color) || undefined,
    });
  }
  const active = asString(raw.active);
  return {
    version: 1,
    active: profiles.some((p) => p.id === active) ? active : (profiles[0]?.id ?? ""),
    profiles,
    secretaryPath: asString(raw.secretaryPath) || undefined,
    spawnCwd: asString(raw.spawnCwd) || undefined,
  };
}

function run(cmd: string, args: string[], opts: { timeout: number; env?: NodeJS.ProcessEnv }): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout, env: opts.env, maxBuffer: 1024 * 1024 }, (err, stdout) =>
      resolve({ code: err ? 1 : 0, stdout: String(stdout) }));
  });
}

export class AccountManager extends EventEmitter {
  file: AccountsFile = defaultAccounts();
  status = new Map<string, ProfileStatus>();
  private timers: NodeJS.Timeout[] = [];
  private watcher: fs.FSWatcher | null = null;

  load(): void {
    const p = accountsPath();
    try {
      this.file = parseAccounts(fs.readFileSync(p, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this.file = defaultAccounts();
        this.save();
      }
      // A file being edited by hand that does not parse keeps the last good one.
    }
    try {
      const saved = asObject(JSON.parse(fs.readFileSync(usagePath(), "utf8"))) ?? {};
      for (const [id, v] of Object.entries(saved)) {
        const s = asObject(v);
        if (s) this.status.set(id, { health: "unknown", detail: "", checkedAt: 0, ...(s as object) } as ProfileStatus);
      }
    } catch { /* first run */ }
    this.emit("change");
  }

  save(): void {
    fs.mkdirSync(path.dirname(accountsPath()), { recursive: true });
    const tmp = accountsPath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.file, null, 2) + "\n");
    fs.renameSync(tmp, accountsPath());
  }

  private saveUsage(): void {
    try {
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.writeFileSync(usagePath(), JSON.stringify(Object.fromEntries(this.status), null, 2));
    } catch { /* not worth failing over */ }
  }

  start(): void {
    this.load();
    try {
      this.watcher = fs.watch(path.dirname(accountsPath()), (_e, name) => { if (name === "accounts.json") this.load(); });
    } catch { /* no watching, still works */ }
    void this.pollAll();
    this.timers.push(setInterval(() => void this.pollAll(), 5 * 60_000));
    this.timers.push(setInterval(() => void this.pollKind("ollama"), 60_000));
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.watcher?.close();
  }

  profile(id: string): Profile | undefined { return this.file.profiles.find((p) => p.id === id); }

  get active(): Profile | undefined { return this.profile(this.file.active); }

  /** The Claude profile a config dir belongs to (the status line's CLAUDE_CONFIG_DIR). */
  claudeProfileFor(dir: string | undefined): Profile | undefined {
    const want = canonicalConfigDir(dir);
    return this.file.profiles.find((p) => p.kind === "claude" && canonicalConfigDir(p.configDir) === want);
  }

  private setStatus(id: string, patch: Partial<ProfileStatus>): void {
    const prev = this.status.get(id) ?? { health: "unknown", detail: "", checkedAt: 0 };
    this.status.set(id, { ...prev, ...patch, checkedAt: Date.now() });
    this.saveUsage();
    this.emit("change");
  }

  /** One status line call's numbers (from island-hook --statusline). */
  ingestStatusline(payload: Record<string, unknown>): void {
    const p = this.claudeProfileFor(asString(payload.configDir));
    if (!p) return;
    const usage = parseClaudeRateLimits(payload.rate_limits);
    const model = asObject(payload.model);
    const cost = asObject(payload.cost);
    this.setStatus(p.id, {
      ...(usage ? { usage } : {}),
      model: asString(model?.display_name) || asString(model?.id) || this.status.get(p.id)?.model,
      costUsd: isNum(cost?.total_cost_usd) ? cost!.total_cost_usd as number : this.status.get(p.id)?.costUsd,
      health: "ok",
      detail: usage ? "" : "No plan limits reported (API key session?)",
    });
  }

  /** An Agent SDK rate_limit_event from an Island Chat turn on that profile. */
  ingestSdkRateLimit(profileId: string, info: unknown): void {
    const next = mergeSdkRateLimit(this.status.get(profileId)?.usage, info);
    if (next) this.setStatus(profileId, { usage: next, health: "ok" });
  }

  async pollAll(): Promise<void> {
    await Promise.all([this.pollKind("codex"), this.pollKind("ollama"), this.pollKind("anthropic-api")]);
  }

  private async pollKind(kind: ProfileKind): Promise<void> {
    for (const p of this.file.profiles.filter((x) => x.kind === kind)) {
      try {
        if (kind === "codex") await this.pollCodex(p);
        else if (kind === "ollama") await this.pollOllama(p);
        else if (kind === "anthropic-api") await this.pollApi(p);
      } catch (e) {
        this.setStatus(p.id, { health: "error", detail: String((e as Error).message ?? e).slice(0, 200) });
      }
    }
  }

  /** `codex app-server`: initialize, initialized, account/rateLimits/read, then close its input. */
  private pollCodex(p: Profile): Promise<void> {
    return new Promise((resolve) => {
      const env = { ...process.env, ...(p.codexHome ? { CODEX_HOME: expandHome(p.codexHome) } : {}) };
      let child;
      try {
        child = spawn("codex", ["app-server"], { env, stdio: ["pipe", "pipe", "ignore"] });
      } catch {
        this.setStatus(p.id, { health: "error", detail: "codex is not installed" });
        resolve();
        return;
      }
      let buf = "";
      const done = (patch: Partial<ProfileStatus>) => {
        clearTimeout(timer);
        child.kill();
        this.setStatus(p.id, patch);
        resolve();
      };
      const timer = setTimeout(() => done({ health: "error", detail: "codex app-server did not answer" }), 15000);
      child.on("error", () => done({ health: "error", detail: "codex is not installed" }));
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          let msg: Record<string, unknown> | null = null;
          try { msg = asObject(JSON.parse(line)); } catch { continue; }
          if (msg?.id !== 2) continue;
          const usage = parseCodexRateLimits(msg.result);
          done(usage ? { usage, health: "ok", detail: "" } : { health: "error", detail: "Codex sent no limits (not signed in?)" });
        }
      });
      child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "omarchy-island", version: "1" } } }) + "\n");
      child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
      child.stdin.write(JSON.stringify({ id: 2, method: "account/rateLimits/read" }) + "\n");
    });
  }

  private async pollOllama(p: Profile): Promise<void> {
    const base = (p.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    try {
      const res = await fetch(base + "/api/tags", { signal: AbortSignal.timeout(3000) });
      const body = asObject(await res.json());
      const models = (Array.isArray(body?.models) ? body!.models : []).map((m) => asString(asObject(m)?.name)).filter(Boolean);
      p.models = models;
      this.setStatus(p.id, { health: "ok", detail: `${models.length} model${models.length === 1 ? "" : "s"}` });
    } catch {
      this.setStatus(p.id, { health: "error", detail: "Ollama is not running" });
    }
  }

  private async pollApi(p: Profile): Promise<void> {
    const key = await this.apiKey(p).catch(() => "");
    this.setStatus(p.id, key ? { health: "ok", detail: "Key available" } : { health: "error", detail: "No API key (apiKeyEnv / apiKeyCommand)" });
  }

  /** The key of an API profile, read at the moment it is needed and never kept. */
  async apiKey(p: Profile): Promise<string> {
    if (p.apiKeyEnv && process.env[p.apiKeyEnv]) return String(process.env[p.apiKeyEnv]);
    if (p.apiKeyCommand) {
      const r = await run("sh", ["-c", p.apiKeyCommand], { timeout: 20000 });
      const key = r.stdout.trim();
      if (r.code === 0 && key) return key;
    }
    throw new Error(`no API key for ${p.id}`);
  }

  /**
   * Makes a profile the default for new shells: active-profile.env (sourced
   * from the shell rc) and an `active-claude` symlink to its config dir.
   */
  setActive(id: string): void {
    const p = this.profile(id);
    if (!p) throw new Error(`no profile ${id}`);
    this.file.active = id;
    this.save();
    const lines = [
      "# Managed by omarchy-dynamic-island (island-ctl profile / the island's Claude Plans tab).",
      "# Source it from your shell rc:  [ -f ~/.config/omarchy-dynamic-island/active-profile.env ] && . ~/.config/omarchy-dynamic-island/active-profile.env",
      `export ISLAND_PROFILE=${shq(p.id)}`,
    ];
    if (p.kind === "claude") {
      const dir = canonicalConfigDir(p.configDir);
      lines.push(dir ? `export CLAUDE_CONFIG_DIR=${shq(dir)}` : "unset CLAUDE_CONFIG_DIR");
      const link = path.join(configDir(), "active-claude");
      try { fs.rmSync(link, { force: true }); fs.symlinkSync(dir || path.join(os.homedir(), ".claude"), link); } catch { /* optional */ }
    }
    if (p.kind === "codex") lines.push(p.codexHome ? `export CODEX_HOME=${shq(expandHome(p.codexHome))}` : "unset CODEX_HOME");
    const tmp = activeEnvPath() + ".tmp";
    fs.writeFileSync(tmp, lines.join("\n") + "\n");
    fs.renameSync(tmp, activeEnvPath());
    this.emit("change");
  }

  /** What a herdr tab for this profile runs, and with which environment. */
  spawnSpec(id: string): { env: Record<string, string>; command: string; cwd: string; label: string } {
    const p = this.profile(id);
    if (!p) throw new Error(`no profile ${id}`);
    const cwd = expandHome(this.file.spawnCwd || "~");
    if (p.kind === "claude") {
      const dir = canonicalConfigDir(p.configDir);
      return { env: dir ? { CLAUDE_CONFIG_DIR: dir } : {}, command: "claude", cwd, label: p.label };
    }
    if (p.kind === "codex") return { env: p.codexHome ? { CODEX_HOME: expandHome(p.codexHome) } : {}, command: "codex", cwd, label: p.label };
    if (p.kind === "ollama") {
      const model = p.defaultModel || p.models?.[0];
      if (!model) throw new Error("no Ollama model to run");
      return { env: {}, command: `ollama run ${shq(model)}`, cwd, label: p.label };
    }
    // A key on a command line or in an env flag would be visible in `ps`.
    throw new Error("API key profiles are used from Island Chat, not in a terminal");
  }

  secretaryPath(): string {
    return expandHome(this.file.secretaryPath || "~/secretary");
  }

  /** What the island shows: every profile with its numbers and how many sessions run on it. */
  snapshot(sessionsByDir: Record<string, number>): unknown[] {
    return this.file.profiles.map((p) => {
      const s = this.status.get(p.id);
      return {
        id: p.id, label: p.label, kind: p.kind, color: p.color ?? "",
        active: p.id === this.file.active,
        models: p.kind === "claude" ? (p.models?.length ? p.models : CLAUDE_MODELS) : p.kind === "anthropic-api" ? (p.models?.length ? p.models : CLAUDE_MODELS) : (p.models ?? []),
        defaultModel: p.defaultModel ?? (p.kind === "ollama" ? (p.models?.[0] ?? "") : "claude-opus-5-5"),
        fiveHour: s?.usage?.fiveHour ?? null,
        sevenDay: s?.usage?.sevenDay ?? null,
        updatedAt: s?.usage?.updatedAt ?? 0,
        model: s?.model ?? "",
        costUsd: s?.costUsd ?? null,
        health: s?.health ?? "unknown",
        detail: s?.detail ?? "",
        sessions: p.kind === "claude" ? (sessionsByDir[canonicalConfigDir(p.configDir)] ?? 0) : 0,
        canSpawn: p.kind !== "anthropic-api",
      };
    });
  }
}

function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
