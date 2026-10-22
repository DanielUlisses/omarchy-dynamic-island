// The wire between the island's pieces: the daemon, the island-hook relay
// and the Quickshell island all speak newline-delimited JSON-RPC 2.0 over one
// Unix socket, /tmp/omarchy-island-$UID.sock.
//
// Hooks open a connection per event and send one request; only a permission
// request keeps its connection open until someone decides. The island opens
// one long-lived connection, calls `island.subscribe`, and from then on gets
// `state` (and `chat.*`) notifications pushed to it.

import os from "node:os";
import path from "node:path";

export function socketPath(): string {
  const override = process.env.OMARCHY_ISLAND_SOCKET;
  if (override) return override;
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `/tmp/omarchy-island-${uid}.sock`;
}

export const configDir = (): string =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "omarchy-dynamic-island");

export const stateDir = (): string =>
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "omarchy-dynamic-island");

export interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL = -32603;

/** One line in, at most this many bytes: a hook carrying a whole Write fits. */
export const MAX_LINE = 4 * 1024 * 1024;

/** Splits a byte stream into lines; anything past MAX_LINE without a newline is dropped. */
export class LineSplitter {
  private buf = "";
  private overflow = false;

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    let data = chunk;
    while (data.length > 0) {
      const nl = data.indexOf("\n");
      if (nl === -1) {
        if (!this.overflow) this.buf += data;
        if (this.buf.length > MAX_LINE) { this.buf = ""; this.overflow = true; }
        return;
      }
      const piece = this.buf + data.slice(0, nl);
      data = data.slice(nl + 1);
      if (!this.overflow && piece.trim()) this.onLine(piece);
      this.buf = "";
      this.overflow = false;
    }
  }
}

export function encode(message: RpcRequest | RpcResponse | RpcNotification): string {
  return JSON.stringify(message) + "\n";
}

export const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ---- what a hook event carries, after island-hook has added its context

export type AgentTag = "claude" | "codex" | "gemini" | "cursor" | "pi-agent" | "opencode" | string;

export interface HookEvent {
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  message?: string;
  permission_suggestions?: unknown[];
  /** Added by island-hook. */
  island: {
    agent: AgentTag;
    herdrPane?: string;
    herdrSession?: string;
    configDir?: string;
    pid?: number;
    diffTruncated?: boolean;
  };
  [key: string]: unknown;
}

/** What the island answers to a held permission request. */
export type Decision =
  | { kind: "allow" }
  | { kind: "always_allow" }
  | { kind: "deny"; message?: string }
  | { kind: "answer"; answers: Record<string, string | string[]> };
