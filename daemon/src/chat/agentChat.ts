// Island Chat: a conversation with an agent from the island itself, on any of
// the configured accounts.
//
// - A Claude subscription profile runs through the Claude Agent SDK, which is
//   Claude Code as a library, signed in through that profile's
//   CLAUDE_CONFIG_DIR. The Secretary workspace is the same thing started in
//   the secretary repo, so its CLAUDE.md and skills apply.
// - An Anthropic API profile runs a Messages API tool loop with its key.
// - An Ollama profile talks to the local Ollama server (no tools).
//
// Either Claude back end gets the island's own tools (tools.ts). Anything that
// changes something asks first, on the same approval card hook sessions use.

import Anthropic from "@anthropic-ai/sdk";
import { createSdkMcpServer, query, tool as sdkTool, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalConfigDir, type AccountManager, type Profile } from "../accounts/accountManager.js";
import type { HerdrBridge } from "../herdr/herdrBridge.js";
import { asObject, asString } from "../protocol.js";
import type { SessionStore } from "../store/sessionStore.js";
import { jsonSchema, parseArgs, TOOLS, toolByName, type ToolContext } from "./tools.js";

export type Workspace = "island" | "secretary";

export interface ChatTool { id: string; name: string; summary: string; status: "running" | "done" | "error" | "denied" }

export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  tools: ChatTool[];
  attachments: string[];
}

const MAX_ATTACH_TEXT = 200 * 1024;
const MAX_ATTACH_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
/** Models that take the server-side refusal fallback ("default" form). */
const FALLBACK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"];

const ISLAND_PROMPT =
  "You are the Omarchy desktop assistant, living in the Dynamic Island at the top of the user's screen. " +
  "You can see the coding agents running in herdr panes on their machines and the Claude Code sessions reporting to the island, " +
  "read their terminals and the diffs they made, type into their panes, open new panes, and apply git patches. " +
  "Keep answers short: they show in a small panel. Look before you act, and say what you are about to change.";

type ApiBlock = Anthropic.Beta.BetaContentBlockParam;

/** A dropped file or screen capture as Messages API content, or a note when it can't be sent. */
export function attachmentBlocks(files: string[]): { blocks: ApiBlock[]; names: string[] } {
  const blocks: ApiBlock[] = [];
  const names: string[] = [];
  for (const raw of files) {
    const file = raw.replace(/^file:\/\//, "");
    const name = path.basename(file);
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile()) continue;
    names.push(name);
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (type) {
      if (stat.size > MAX_ATTACH_IMAGE) { blocks.push({ type: "text", text: `[${name}: image too large to attach]` }); continue; }
      blocks.push({ type: "image", source: { type: "base64", media_type: type, data: fs.readFileSync(file).toString("base64") } });
    } else if (path.extname(file).toLowerCase() === ".pdf" && stat.size < 20 * 1024 * 1024) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(file).toString("base64") } });
    } else {
      const buf = fs.readFileSync(file);
      if (buf.subarray(0, 8000).includes(0)) { blocks.push({ type: "text", text: `[${name}: binary file, not attached]` }); continue; }
      const text = buf.subarray(0, MAX_ATTACH_TEXT).toString("utf8");
      blocks.push({ type: "text", text: `<file path="${file}">\n${text}${buf.length > MAX_ATTACH_TEXT ? "\n[…truncated]" : ""}\n</file>` });
    }
  }
  return { blocks, names };
}

export class AgentChat extends EventEmitter {
  messages: ChatMessage[] = [];
  busy = false;
  profileId = "";
  model = "";
  workspace: Workspace = "island";
  error = "";
  private nextId = 1;
  private abort: AbortController | null = null;
  private sdkSession = "";
  private apiHistory: Anthropic.Beta.BetaMessageParam[] = [];
  private ollamaHistory: { role: string; content: string; images?: string[] }[] = [];
  /** What the conversation is bound to; changing any of these starts afresh. */
  private boundTo = "";

  constructor(private readonly ctx: ToolContext & { accounts: AccountManager; store: SessionStore; herdr: HerdrBridge }) {
    super();
  }

  private changed(): void { this.emit("change"); }

  snapshot(): unknown {
    return {
      busy: this.busy, profileId: this.profileId, model: this.model, workspace: this.workspace, error: this.error,
      messages: this.messages.slice(-40),
    };
  }

  reset(): void {
    this.stop();
    this.messages = [];
    this.sdkSession = "";
    this.apiHistory = [];
    this.ollamaHistory = [];
    this.error = "";
    this.changed();
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
  }

  configure(opts: { profileId?: string; model?: string; workspace?: Workspace }): void {
    if (opts.profileId !== undefined) this.profileId = opts.profileId;
    if (opts.model !== undefined) this.model = opts.model;
    if (opts.workspace !== undefined) this.workspace = opts.workspace === "secretary" ? "secretary" : "island";
    this.changed();
  }

  async send(text: string, files: string[]): Promise<void> {
    if (this.busy) throw new Error("still answering");
    const profile = this.ctx.accounts.profile(this.profileId) ?? this.ctx.accounts.active
      ?? this.ctx.accounts.file.profiles.find((p) => p.kind === "claude");
    if (!profile) throw new Error("no account configured (accounts.json)");
    this.profileId = profile.id;
    if (!this.model) this.model = profile.defaultModel || (profile.kind === "ollama" ? profile.models?.[0] ?? "" : "claude-opus-5-5");
    const binding = `${profile.id}|${this.workspace}`;
    if (binding !== this.boundTo) { this.sdkSession = ""; this.apiHistory = []; this.ollamaHistory = []; this.boundTo = binding; }

    const { blocks, names } = attachmentBlocks(files);
    this.messages.push({ id: this.nextId++, role: "user", text, tools: [], attachments: names });
    const reply: ChatMessage = { id: this.nextId++, role: "assistant", text: "", tools: [], attachments: [] };
    this.messages.push(reply);
    this.busy = true;
    this.error = "";
    this.abort = new AbortController();
    this.changed();
    try {
      if (profile.kind === "claude" || (this.workspace === "secretary" && profile.kind === "anthropic-api")) await this.viaAgentSdk(profile, text, blocks, reply);
      else if (profile.kind === "anthropic-api") await this.viaApi(profile, text, blocks, reply);
      else if (profile.kind === "ollama") await this.viaOllama(profile, text, files, reply);
      else throw new Error(`${profile.label} can't chat (only Claude, Anthropic API and Ollama accounts can)`);
    } catch (e) {
      if (!this.abort?.signal.aborted) {
        this.error = e instanceof Anthropic.APIError ? `API error ${e.status}: ${e.message}` : String((e as Error).message ?? e);
        this.messages.push({ id: this.nextId++, role: "error", text: this.error, tools: [], attachments: [] });
      }
    } finally {
      this.busy = false;
      this.abort = null;
      if (!reply.text && reply.tools.length === 0) this.messages = this.messages.filter((m) => m !== reply);
      this.changed();
    }
  }

  // ---- approvals for the chat's own tool calls

  private async approve(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    const { id, decision } = this.ctx.store.requestApproval({
      source: "chat", sessionId: "island-chat", agent: "island", project: this.workspace === "secretary" ? "secretary" : "Island Chat",
      herdrPane: "", tool: toolName, input, canAlwaysAllow: true,
    });
    // Stopping the chat withdraws the card.
    this.abort?.signal.addEventListener("abort", () => this.ctx.store.cancel(id), { once: true });
    const d = await decision;
    return !!d && (d.kind === "allow" || d.kind === "always_allow");
  }

  private toolStarted(reply: ChatMessage, id: string, name: string, input: unknown): ChatTool {
    const t: ChatTool = { id, name: name.replace(/^mcp__island__/, ""), summary: summarize(input), status: "running" };
    reply.tools.push(t);
    this.changed();
    return t;
  }

  // ---- Claude Agent SDK (subscription accounts, Secretary)

  private async viaAgentSdk(profile: Profile, text: string, blocks: ApiBlock[], reply: ChatMessage): Promise<void> {
    const server = createSdkMcpServer({
      name: "island",
      version: "1.0.0",
      tools: TOOLS.map((t) => sdkTool(t.name, t.description, t.shape, async (args) => {
        try {
          return { content: [{ type: "text" as const, text: await t.run(args as Record<string, unknown>, this.ctx) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: String((e as Error).message ?? e) }], isError: true };
        }
      })),
    });

    const env: Record<string, string | undefined> = { ...process.env, ISLAND_HOOK_DISABLE: "1" };
    const dir = profile.kind === "claude" ? canonicalConfigDir(profile.configDir) : "";
    if (dir) env.CLAUDE_CONFIG_DIR = dir; else delete env.CLAUDE_CONFIG_DIR;
    // An API account in the Secretary workspace: Claude Code on that key.
    if (profile.kind === "anthropic-api") env.ANTHROPIC_API_KEY = await this.ctx.accounts.apiKey(profile);

    const secretary = this.workspace === "secretary";
    const cwd = secretary ? this.ctx.accounts.secretaryPath() : os.homedir();
    if (secretary && !fs.existsSync(path.join(cwd, "CLAUDE.md")))
      throw new Error(`no secretary checkout at ${cwd} (set "secretaryPath" in accounts.json)`);

    const content: ApiBlock[] = [...blocks, { type: "text", text }];
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield { type: "user", message: { role: "user", content: content as never }, parent_tool_use_id: null };
    }

    const readOnly = new Set(TOOLS.filter((t) => t.readOnly).map((t) => "mcp__island__" + t.name));
    const q = query({
      prompt: prompt(),
      options: {
        cwd,
        env,
        model: this.model || undefined,
        abortController: this.abort ?? undefined,
        includePartialMessages: true,
        resume: this.sdkSession || undefined,
        mcpServers: { island: server },
        // Secretary is its repo: its CLAUDE.md, skills and settings. The plain
        // island chat starts clean, so no user hooks fire inside it.
        settingSources: secretary ? ["user", "project", "local"] : [],
        systemPrompt: { type: "preset", preset: "claude_code", append: ISLAND_PROMPT },
        canUseTool: async (toolName, input) => {
          if (readOnly.has(toolName) || ["Read", "Glob", "Grep", "LS", "TodoWrite"].includes(toolName))
            return { behavior: "allow", updatedInput: input };
          return (await this.approve(toolName.replace(/^mcp__island__/, ""), input))
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "The user declined this on the island." };
        },
      },
    });

    const running = new Map<string, ChatTool>();
    for await (const msg of q) {
      if (msg.type === "system" && "session_id" in msg && msg.session_id) this.sdkSession = msg.session_id;
      if (msg.type === "stream_event" && msg.parent_tool_use_id === null) {
        const ev = msg.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { reply.text += ev.delta.text; this.changed(); }
      } else if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
        for (const b of msg.message.content) if (b.type === "tool_use") running.set(b.id, this.toolStarted(reply, b.id, b.name, b.input));
      } else if (msg.type === "user") {
        const blocksIn = Array.isArray(msg.message.content) ? msg.message.content : [];
        for (const b of blocksIn) {
          const o = asObject(b);
          if (o?.type !== "tool_result") continue;
          const t = running.get(asString(o.tool_use_id));
          if (t) { t.status = o.is_error ? "error" : "done"; this.changed(); }
        }
      } else if (msg.type === "rate_limit_event") {
        if (profile.kind === "claude") this.ctx.accounts.ingestSdkRateLimit(profile.id, msg.rate_limit_info);
      } else if (msg.type === "result") {
        this.sdkSession = msg.session_id || this.sdkSession;
        if (msg.subtype !== "success") throw new Error(`the agent stopped: ${msg.subtype}`);
        if (!reply.text && typeof msg.result === "string") reply.text = msg.result;
      }
    }
  }

  // ---- Messages API (API key accounts)

  private async viaApi(profile: Profile, text: string, blocks: ApiBlock[], reply: ChatMessage): Promise<void> {
    const client = new Anthropic({ apiKey: await this.ctx.accounts.apiKey(profile) });
    const model = this.model || "claude-opus-5-5";
    const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
      name: t.name, description: t.description, input_schema: jsonSchema(t) as Anthropic.Beta.BetaTool.InputSchema,
    }));
    this.apiHistory.push({ role: "user", content: [...blocks, { type: "text", text }] });
    for (let turn = 0; turn < 20; turn++) {
      const fallback = FALLBACK_MODELS.includes(model);
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 32000,
        system: ISLAND_PROMPT,
        thinking: { type: "adaptive" },
        tools,
        messages: this.apiHistory,
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      }, { signal: this.abort?.signal });
      stream.on("text", (delta) => { reply.text += delta; this.changed(); });
      const message = await stream.finalMessage();
      this.apiHistory.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      if (message.stop_reason === "refusal") throw new Error("Claude declined this request.");
      if (message.stop_reason === "pause_turn") continue;
      const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0 || message.stop_reason === "end_turn") return;
      if (message.stop_reason === "max_tokens") throw new Error("the answer ran out of room");
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const t = toolByName(use.name);
        const shown = this.toolStarted(reply, use.id, use.name, use.input);
        const finish = (content: string, status: ChatTool["status"], isError = false) => {
          shown.status = status;
          results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
          this.changed();
        };
        if (!t) { finish(`unknown tool ${use.name}`, "error", true); continue; }
        const parsed = parseArgs(t, use.input);
        if (!parsed.ok) { finish(`invalid input: ${parsed.error}`, "error", true); continue; }
        if (!t.readOnly && !(await this.approve(t.name, parsed.args))) { finish("The user declined this on the island.", "denied", true); continue; }
        try { finish(await t.run(parsed.args, this.ctx), "done"); } catch (e) { finish(String((e as Error).message ?? e), "error", true); }
      }
      this.apiHistory.push({ role: "user", content: results });
    }
  }

  // ---- Ollama (local models; plain conversation)

  private async viaOllama(profile: Profile, text: string, files: string[], reply: ChatMessage): Promise<void> {
    const base = (profile.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const images = files.filter((f) => IMAGE_TYPES[path.extname(f).toLowerCase()])
      .map((f) => fs.readFileSync(f.replace(/^file:\/\//, "")).toString("base64"));
    const extra = attachmentBlocks(files.filter((f) => !IMAGE_TYPES[path.extname(f).toLowerCase()])).blocks
      .map((b) => (b.type === "text" ? b.text : "")).join("\n");
    this.ollamaHistory.push({ role: "user", content: extra ? `${extra}\n\n${text}` : text, ...(images.length ? { images } : {}) });
    const res = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, stream: true, messages: [{ role: "system", content: ISLAND_PROMPT }, ...this.ollamaHistory] }),
      signal: this.abort?.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}`);
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try {
          const o = asObject(JSON.parse(line));
          const piece = asString(asObject(o?.message)?.content);
          if (piece) { reply.text += piece; this.changed(); }
          if (o?.error) throw new Error(asString(o.error));
        } catch (e) { if (e instanceof Error && !(e instanceof SyntaxError)) throw e; }
      }
    }
    this.ollamaHistory.push({ role: "assistant", content: reply.text });
  }
}

function summarize(input: unknown): string {
  const o = asObject(input) ?? {};
  const s = ["command", "pane", "cwd", "repo", "session", "file_path", "pattern", "query", "url", "description"]
    .map((k) => asString(o[k])).find((v) => v) ?? "";
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}
