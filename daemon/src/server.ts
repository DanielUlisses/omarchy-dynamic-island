// The daemon's socket: JSON-RPC 2.0, one request or notification per line.
// Hook relays call `hook.event` and `statusline`; the island calls
// `island.subscribe` once and then gets `state` and `chat` pushed to it.

import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AccountManager } from "./accounts/accountManager.js";
import type { AgentChat } from "./chat/agentChat.js";
import type { HerdrBridge } from "./herdr/herdrBridge.js";
import {
  asObject, asString, encode, LineSplitter, RPC_INTERNAL, RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND, RPC_PARSE_ERROR,
  stateDir, type Decision, type HookEvent, type RpcNotification, type RpcRequest,
} from "./protocol.js";
import type { SessionStore } from "./store/sessionStore.js";

class RpcError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

interface Client { sock: net.Socket; subscribed: boolean }

export interface Services {
  store: SessionStore;
  herdr: HerdrBridge;
  accounts: AccountManager;
  chat: AgentChat;
  /** Report hold/resume of approvals to herdr (pane.report_agent). */
  reportToHerdr: boolean;
}

export function parseDecision(raw: unknown): Decision | null {
  if (raw === "allow") return { kind: "allow" };
  if (raw === "always_allow" || raw === "always") return { kind: "always_allow" };
  if (raw === "deny") return { kind: "deny" };
  const o = asObject(raw);
  if (!o) return null;
  if (o.kind === "deny") return { kind: "deny", message: asString(o.message) || undefined };
  const answers = asObject(o.answers);
  if (answers) {
    const clean: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (typeof v === "string") clean[k] = v;
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) clean[k] = v as string[];
      else return null;
    }
    return { kind: "answer", answers: clean };
  }
  return parseDecision(o.kind);
}

export class IslandServer {
  private server: net.Server | null = null;
  private clients = new Set<Client>();
  private stateTimer: NodeJS.Timeout | null = null;
  private chatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly path: string, private readonly s: Services) {
    s.store.on("change", () => this.schedule("state"));
    s.accounts.on("change", () => this.schedule("state"));
    s.chat.on("change", () => this.schedule("chat"));
  }

  /** Listens, unless another daemon already owns the socket (then resolves false). */
  async listen(): Promise<boolean> {
    if (fs.existsSync(this.path)) {
      const alive = await new Promise<boolean>((resolve) => {
        const c = net.createConnection({ path: this.path });
        c.once("connect", () => { c.destroy(); resolve(true); });
        c.once("error", () => resolve(false));
      });
      if (alive) return false;
      fs.rmSync(this.path, { force: true });
    }
    this.server = net.createServer((sock) => this.accept(sock));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.path, () => resolve());
    });
    fs.chmodSync(this.path, 0o600);
    return true;
  }

  close(): void {
    for (const c of this.clients) c.sock.destroy();
    this.server?.close();
    fs.rmSync(this.path, { force: true });
  }

  private schedule(kind: "state" | "chat"): void {
    if (kind === "state") {
      if (this.stateTimer) return;
      this.stateTimer = setTimeout(() => { this.stateTimer = null; this.broadcast("state", this.snapshot()); }, 80);
    } else {
      if (this.chatTimer) return;
      this.chatTimer = setTimeout(() => { this.chatTimer = null; this.broadcast("chat", this.s.chat.snapshot()); }, 60);
    }
  }

  private broadcast(method: string, params: unknown): void {
    const line = encode({ jsonrpc: "2.0", method, params } satisfies RpcNotification);
    for (const c of this.clients) if (c.subscribed && !c.sock.destroyed) c.sock.write(line);
  }

  snapshot(): Record<string, unknown> {
    const agents = this.s.store.merged();
    return {
      agents,
      approvals: this.s.store.approvals(),
      accounts: this.s.accounts.snapshot(this.s.store.sessionsByConfigDir()),
      herdr: { available: this.s.herdr.available, agents: this.s.store.herdrAgents },
      totals: { added: agents.reduce((n, a) => n + a.added, 0), removed: agents.reduce((n, a) => n + a.removed, 0) },
      secretary: { path: this.s.accounts.secretaryPath(), present: fs.existsSync(path.join(this.s.accounts.secretaryPath(), "CLAUDE.md")) },
    };
  }

  private accept(sock: net.Socket): void {
    const client: Client = { sock, subscribed: false };
    this.clients.add(client);
    sock.setEncoding("utf8");
    const split = new LineSplitter((line) => void this.handle(client, line));
    sock.on("data", (c: string) => split.push(c));
    sock.on("close", () => this.clients.delete(client));
    sock.on("error", () => this.clients.delete(client));
  }

  private reply(client: Client, id: RpcRequest["id"] | null, result: unknown, error?: RpcError): void {
    if (id === undefined || client.sock.destroyed) return;
    client.sock.write(encode(error
      ? { jsonrpc: "2.0", id, error: { code: error.code, message: error.message } }
      : { jsonrpc: "2.0", id, result: result ?? null }));
  }

  private async handle(client: Client, line: string): Promise<void> {
    let req: RpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      this.reply(client, null, null, new RpcError(RPC_PARSE_ERROR, "parse error"));
      return;
    }
    try {
      const result = await this.dispatch(client, asString(req.method), asObject(req.params) ?? {});
      this.reply(client, req.id, result);
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError(RPC_INTERNAL, String((e as Error).message ?? e));
      this.reply(client, req.id, null, err);
    }
  }

  private async dispatch(client: Client, method: string, p: Record<string, unknown>): Promise<unknown> {
    const { store, herdr, accounts, chat } = this.s;
    switch (method) {
      case "daemon.ping": return { ok: true, pid: process.pid };
      case "hook.event": return this.hookEvent(client, p as unknown as HookEvent);
      case "statusline": accounts.ingestStatusline(p); return {};

      case "island.subscribe":
        client.subscribed = true;
        return { state: this.snapshot(), chat: chat.snapshot() };
      case "state.get": return this.snapshot();

      case "approval.decide": {
        const d = parseDecision(p.decision);
        const id = asString(p.id) || store.approvals()[0]?.id || "";
        if (!d) throw new RpcError(RPC_INVALID_PARAMS, "decision must be allow, always_allow, deny or { answers }");
        if (!id || !store.decide(id, d)) throw new RpcError(RPC_INVALID_PARAMS, id ? "nothing waiting under that id, or the answer does not fit" : "nothing is waiting");
        return { id };
      }
      case "approval.focus": {
        const a = store.approval(asString(p.id)) ?? store.approvals()[0];
        if (!a?.herdrPane) return { focused: false };
        return { focused: await herdr.focus(a.herdrPane), pane: a.herdrPane };
      }

      case "diffs.get": return { session: asString(p.session), diffs: store.diffs(asString(p.session)) };
      case "session.seen": store.markSeen(asString(p.id)); return {};
      case "session.clearDiffs": store.clearDiffs(asString(p.id)); return {};
      case "herdr.refresh": await herdr.poll(); return {};

      case "accounts.setActive": accounts.setActive(asString(p.id)); return {};
      case "accounts.refresh": await accounts.pollAll(); return {};
      case "accounts.spawn": {
        const spec = accounts.spawnSpec(asString(p.id));
        const pane = await herdr.spawn({ ...spec, focus: true });
        return { pane };
      }

      case "chat.configure":
        chat.configure({
          profileId: typeof p.profileId === "string" ? p.profileId : undefined,
          model: typeof p.model === "string" ? p.model : undefined,
          workspace: p.workspace === "secretary" || p.workspace === "island" ? p.workspace : undefined,
        });
        return {};
      case "chat.send": {
        const text = asString(p.text).trim();
        const files = Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === "string").slice(0, 10) : [];
        if (!text && files.length === 0) throw new RpcError(RPC_INVALID_PARAMS, "nothing to send");
        // Answered through `chat` pushes; the call itself returns at once.
        void chat.send(text || "(see the attached files)", files).catch(() => undefined);
        return { accepted: true };
      }
      case "chat.stop": chat.stop(); return {};
      case "chat.reset": chat.reset(); return {};
      case "chat.capture": return { path: await captureRegion() };

      default:
        throw new RpcError(RPC_METHOD_NOT_FOUND, `no method ${method}`);
    }
  }

  private async hookEvent(client: Client, ev: HookEvent): Promise<unknown> {
    const { store, herdr } = this.s;
    if (!ev || typeof ev.hook_event_name !== "string" || !asObject(ev.island)) throw new RpcError(RPC_INVALID_PARAMS, "not a hook event");
    if (ev.hook_event_name !== "PermissionRequest") {
      store.ingest(ev);
      return {};
    }
    const s = store.ingest({ ...ev, hook_event_name: "PreToolUse" });
    const sessionId = s?.id ?? ev.session_id ?? "";
    const tool = ev.tool_name ?? "";
    if (tool !== "AskUserQuestion" && store.isAlwaysAllowed(sessionId, tool)) return { decision: { kind: "allow" } };

    const { id, decision } = store.requestApproval({
      source: "hook", sessionId, agent: ev.island.agent, project: s?.project ?? "", herdrPane: s?.herdrPane ?? "",
      tool, input: ev.tool_input,
    });
    // The relay hanging up (Claude Code answered in its terminal, or gave up)
    // takes the card away.
    const onClose = () => store.cancel(id);
    client.sock.once("close", onClose);
    const pane = s?.herdrPane ?? "";
    if (this.s.reportToHerdr && pane) void herdr.reportAgent(pane, ev.island.agent, "blocked", `Wants to use ${tool}`);
    const d = await decision;
    client.sock.off("close", onClose);
    if (this.s.reportToHerdr && pane) void herdr.reportAgent(pane, ev.island.agent, d && d.kind !== "deny" ? "working" : "idle");
    return { decision: d };
  }
}

/** A screen region the user picks with slurp, as a PNG in the state dir. */
export function captureRegion(): Promise<string> {
  const dir = path.join(stateDir(), "captures");
  fs.mkdirSync(dir, { recursive: true });
  // Keep the last 20 captures.
  const old = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 19))) fs.rmSync(path.join(dir, f), { force: true });
  const file = path.join(dir, `capture-${Date.now()}.png`);
  return new Promise((resolve, reject) => {
    execFile("sh", ["-c", 'g=$(slurp) || exit 3; grim -g "$g" "$1"', "sh", file], { timeout: 120_000, env: { ...process.env, HOME: os.homedir() } },
      (err) => {
        if (err) reject(new Error((err as NodeJS.ErrnoException).code === "ENOENT" ? "grim/slurp not installed" : "capture cancelled"));
        else resolve(file);
      });
  });
}
