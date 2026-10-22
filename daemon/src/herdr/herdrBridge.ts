// herdr (https://herdr.dev): the terminal multiplexer the coding agents run
// in. The bridge asks every herdr machine for its agents every few seconds
// (herdr pushes events only per pane and per server, so polling every machine
// at once is cheaper than a subscription each), and wraps the CLI calls the
// island and Island Chat need: report an agent's state, read a pane, type
// into it, open a new tab.
//
// Agents come out in the same shape as IslandModel.herdrParse, so the
// island's Herdr.qml can take them as they are.

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface HerdrAgent {
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
  cwd: string;
}

const PANE_RE = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}$/;
const MACHINE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const validPane = (p: string): boolean => PANE_RE.test(p);
export const validMachine = (m: string): boolean => m === "" || MACHINE_RE.test(m);

function plainText(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function baseName(p: unknown): string {
  const s = String(p ?? "").replace(/\/+$/, "");
  return s.substring(s.lastIndexOf("/") + 1);
}

/** The poll script's output -> agents, and the machines that did not answer. */
export function parsePoll(text: string): { agents: HerdrAgent[]; failed: string[]; missing: boolean } {
  if (text.startsWith("@@NOHERDR")) return { agents: [], failed: [], missing: true };
  const agents: HerdrAgent[] = [];
  const failed: string[] = [];
  const sections = text.split(/^@@HERDR /m);
  for (let i = 1; i < sections.length; i++) {
    const body = sections[i];
    const nl = body.indexOf("\n");
    const head = nl < 0 ? body : body.substring(0, nl);
    const json = nl < 0 ? "" : body.substring(nl + 1).trim();
    const words = head.trim().split(" ");
    const id = words[0] || "";
    const machine = id === "local" ? "" : id;
    const target = words[1] && words[1] !== "-" ? words[1] : "";
    const session = words[2] || "default";
    const label = words.slice(3).join(" ").trim();
    let list: unknown[] | null = null;
    try {
      const parsed = JSON.parse(json);
      list = Array.isArray(parsed?.result?.agents) ? parsed.result.agents : null;
    } catch { /* that machine did not answer */ }
    if (!list) { failed.push(machine); continue; }
    for (const raw of list) {
      const a = (raw ?? {}) as Record<string, unknown>;
      const pane = String(a.pane_id ?? "");
      if (!pane) continue;
      const cwd = String(a.foreground_cwd ?? a.cwd ?? "");
      agents.push({
        key: (machine || "local") + "/" + pane,
        machine, target, session, label, pane,
        agent: String(a.agent ?? ""),
        status: String(a.agent_status ?? "unknown"),
        title: plainText(a.terminal_title_stripped ?? a.terminal_title ?? ""),
        project: baseName(cwd).split("--")[0],
        cwd,
      });
    }
  }
  return { agents, failed, missing: false };
}

interface RunResult { code: number; stdout: string; stderr: string }

function run(cmd: string, args: string[], timeoutMs: number, input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
    if (input !== undefined) { child.stdin?.end(input); }
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/src/herdr -> daemon/scripts
const POLL_SCRIPT = path.resolve(here, "..", "..", "..", "scripts", "herdr-poll.sh");

export class HerdrBridge {
  agents: HerdrAgent[] = [];
  available = true;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly onChange: (agents: HerdrAgent[]) => void, private intervalMs = 4000) {}

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const r = await run("bash", [POLL_SCRIPT], 15000);
      const parsed = parsePoll(r.stdout);
      if (parsed.missing) {
        this.available = false;
        this.agents = [];
        this.stop();
      } else {
        // A machine that did not answer keeps what it said last time.
        const kept = this.agents.filter((a) => parsed.failed.includes(a.machine));
        this.agents = parsed.agents.concat(kept);
      }
      this.onChange(this.agents);
    } finally {
      this.polling = false;
    }
  }

  find(pane: string, machine = ""): HerdrAgent | undefined {
    return this.agents.find((a) => a.pane === pane && a.machine === machine);
  }

  private base(machine: string): string[] {
    if (!validMachine(machine)) throw new Error("bad machine id");
    return machine ? ["--machine", machine] : [];
  }

  private async herdr(machine: string, args: string[], timeoutMs = 10000): Promise<RunResult> {
    if (!this.available) throw new Error("herdr is not installed");
    return run("herdr", [...this.base(machine), ...args], timeoutMs);
  }

  /** Tell herdr what an agent in one of its panes is doing (pane.report_agent). */
  async reportAgent(pane: string, agent: string, state: "idle" | "working" | "blocked" | "unknown", message = "", machine = ""): Promise<void> {
    if (!validPane(pane)) return;
    const args = ["pane", "report-agent", pane, "--source", "custom:omarchy-island", "--agent", agent || "claude", "--state", state];
    if (message) args.push("--message", message.slice(0, 200));
    await this.herdr(machine, args).catch(() => undefined);
  }

  async focus(pane: string, machine = ""): Promise<boolean> {
    if (!validPane(pane)) return false;
    return (await this.herdr(machine, ["agent", "focus", pane])).code === 0;
  }

  async read(pane: string, lines = 120, machine = ""): Promise<string> {
    if (!validPane(pane)) throw new Error("bad pane id");
    const n = Math.max(10, Math.min(400, Math.round(lines)));
    const r = await this.herdr(machine, ["pane", "read", pane, "--source", "recent-unwrapped", "--lines", String(n)]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "herdr pane read failed");
    try {
      const parsed = JSON.parse(r.stdout);
      const text = parsed?.result?.read?.text ?? parsed?.result?.text;
      if (typeof text === "string") return text;
    } catch { /* plain text */ }
    return r.stdout;
  }

  /** Types `text` into a pane, then Enter when `submit`. */
  async sendInput(pane: string, text: string, submit: boolean, machine = ""): Promise<void> {
    if (!validPane(pane)) throw new Error("bad pane id");
    const r = await this.herdr(machine, ["pane", "send-text", pane, text]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "herdr pane send-text failed");
    if (submit) await this.herdr(machine, ["pane", "send-keys", pane, "Enter"]);
  }

  /**
   * A new herdr tab in `cwd` with `env`, running `command` in its first pane.
   * Returns the new pane id.
   */
  async spawn(opts: { cwd: string; label: string; env: Record<string, string>; command: string; machine?: string; focus?: boolean }): Promise<string> {
    const machine = opts.machine ?? "";
    const args = ["tab", "create", "--cwd", opts.cwd, "--label", opts.label.slice(0, 40)];
    for (const [k, v] of Object.entries(opts.env)) {
      if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) throw new Error(`bad env name ${k}`);
      args.push("--env", `${k}=${v}`);
    }
    args.push(opts.focus === false ? "--no-focus" : "--focus");
    const r = await this.herdr(machine, args);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "herdr tab create failed");
    let pane = "";
    try {
      const res = JSON.parse(r.stdout)?.result ?? {};
      pane = String(res.root_pane?.pane_id ?? res.tab?.root_pane?.pane_id ?? res.pane?.pane_id ?? "");
    } catch { /* fall through */ }
    if (!validPane(pane)) throw new Error("herdr did not say which pane it opened");
    if (opts.command) {
      const ran = await this.herdr(machine, ["pane", "run", pane, opts.command]);
      if (ran.code !== 0) throw new Error(ran.stderr.trim() || "herdr pane run failed");
    }
    setTimeout(() => void this.poll(), 1500);
    return pane;
  }
}
