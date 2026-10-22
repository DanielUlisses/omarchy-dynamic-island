#!/usr/bin/env node
// island-agent-daemon: the Dynamic Island's local backend. Started by the
// systemd user unit (omarchy-island-daemon.service) or by the island itself
// when it finds no socket. One per user; a second one exits at once.

import fs from "node:fs";
import path from "node:path";
import { AccountManager } from "./accounts/accountManager.js";
import { AgentChat } from "./chat/agentChat.js";
import { HerdrBridge } from "./herdr/herdrBridge.js";
import { asObject, configDir, socketPath } from "./protocol.js";
import { IslandServer } from "./server.js";
import { SessionStore } from "./store/sessionStore.js";

/** Daemon settings: ~/.config/omarchy-dynamic-island/daemon.json (all optional). */
function settings(): { herdrIntervalMs: number; reportToHerdr: boolean } {
  let raw: Record<string, unknown> = {};
  try { raw = asObject(JSON.parse(fs.readFileSync(path.join(configDir(), "daemon.json"), "utf8"))) ?? {}; } catch { /* defaults */ }
  const secs = Number(raw.herdrInterval ?? 4);
  return {
    herdrIntervalMs: Math.max(2, Number.isFinite(secs) ? secs : 4) * 1000,
    reportToHerdr: raw.reportToHerdr !== false,
  };
}

async function main(): Promise<void> {
  const cfg = settings();
  const store = new SessionStore();
  const herdr = new HerdrBridge((agents) => store.setHerdr(agents), cfg.herdrIntervalMs);
  const accounts = new AccountManager();
  const chat = new AgentChat({ store, herdr, accounts });
  const server = new IslandServer(socketPath(), { store, herdr, accounts, chat, reportToHerdr: cfg.reportToHerdr });

  if (!(await server.listen())) {
    console.error(`island-agent-daemon: already running on ${socketPath()}`);
    return;
  }
  accounts.start();
  herdr.start();
  console.error(`island-agent-daemon: listening on ${socketPath()}`);

  const quit = () => {
    herdr.stop();
    accounts.stop();
    chat.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  // Never die over one bad event; say so and carry on.
  process.on("uncaughtException", (e) => console.error("island-agent-daemon:", e));
  process.on("unhandledRejection", (e) => console.error("island-agent-daemon:", e));
}

void main();
