import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanBase, HubBridge, hubSettings, pageUrl, parseDesktop, readToken, validPath } from "../src/hub/hubBridge.js";
import { SessionStore } from "../src/store/sessionStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> test/fixtures
export const fixture = (): unknown =>
  JSON.parse(fs.readFileSync(path.resolve(here, "..", "..", "test", "fixtures", "desktop.json"), "utf8"));

const BASE = "https://tk-hub.example.ts.net";

test("settings: herdr is on without a hub, off with one, unless set", () => {
  assert.equal(hubSettings({}).herdrOn, true);
  assert.equal(hubSettings({ hubUrl: BASE }).herdrOn, false);
  assert.equal(hubSettings({ hubUrl: BASE, herdr: "auto" }).herdrOn, false);
  assert.equal(hubSettings({ hubUrl: BASE, herdr: true }).herdrOn, true);
  assert.equal(hubSettings({ herdr: false }).herdrOn, false);
  assert.equal(hubSettings({ hubUrl: BASE + "/" }).url, BASE);
  assert.equal(hubSettings({}).intervalMs, 10_000);
  assert.equal(hubSettings({ hubInterval: 1 }).intervalMs, 5_000);
  assert.equal(cleanBase("file:///etc/passwd"), "");
  assert.equal(cleanBase("https://user:pw@hub"), "");
});

test("routes the island may call stay under /api/", () => {
  assert.ok(validPath("/api/tasks/42/start"));
  assert.ok(!validPath("/api/../auth"));
  assert.ok(!validPath("https://evil/api/x"));
  assert.ok(!validPath("/ws/ui"));
  assert.ok(!validPath("/api/x?y=1"));
  assert.ok(validPath("/api/boards/dev-bss:/home/daniel/app:export-csv/tickets/07/answer"));
});

test("a page on another host opens on the configured hub", () => {
  assert.equal(pageUrl(BASE, BASE + "/#/today"), BASE + "/#/today");
  assert.equal(pageUrl(BASE, "https://evil.example/#/today"), BASE + "/#/today");
  assert.equal(pageUrl(BASE, "javascript:alert(1)", "#/today"), BASE + "/#/today");
  assert.equal(pageUrl(BASE, "", "#/ticket/b/07"), BASE + "/#/ticket/b/07");
});

test("the contract's answer parses into herdr-shaped rows, moves and meetings", () => {
  const d = parseDesktop(fixture(), BASE);
  assert.deepEqual(d.counts, { needs: 1, review: 1, working: 4 });
  assert.equal(d.agents.length, 3);
  const a = d.agents[0];
  assert.equal(a.key, "hub/dev-bss/export-csv#07");
  assert.equal(a.source, "hub");
  assert.equal(a.status, "blocked");
  assert.equal(a.machine, "dev-bss");
  assert.equal(a.label, "bss");
  assert.equal(a.project, "export-csv");
  assert.equal(a.pane, "");
  assert.equal(a.dialog?.options.length, 3);
  assert.equal(a.answer?.method, "POST");
  assert.equal(d.agents[1].answer, null);
  assert.ok(a.url.startsWith(BASE + "/#/ticket/"));
  assert.equal(d.moves[0].action?.path, "/api/tasks/42/start");
  assert.equal(d.moves[1].action, null);
  assert.equal(d.meetings[0].uid, "abc123@google.com");
  assert.equal(d.meetings[0].capture, true);
  assert.equal(d.meetings[0].start, Date.parse("2026-11-05T15:00:00Z"));
});

test("malformed answers are dropped, not thrown", () => {
  const d = parseDesktop({ agents: [null, { key: "" }, { key: "x", status: "weird" }], moves: [{ id: "m", title: "t", action: { method: "DELETE", path: "/api/x" } }], meetings: [{ id: "1" }] }, BASE);
  assert.equal(d.agents.length, 1);
  assert.equal(d.agents[0].status, "unknown");
  assert.equal(d.moves[0].action, null);
  assert.equal(d.meetings.length, 0);
  assert.deepEqual(parseDesktop("nope", BASE).agents, []);
});

test("the token file must be 0600", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hubtok-"));
  const file = path.join(dir, "hub-token");
  assert.match(readToken(file).error, /no token/);
  fs.writeFileSync(file, "tok123\n", { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  assert.match(readToken(file).error, /chmod 600/);
  fs.chmodSync(file, 0o600);
  assert.deepEqual(readToken(file), { token: "tok123", error: "" });
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeFetch(answers: Array<{ status: number; body: unknown } | Error>, seen: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const next = answers.shift() ?? new Error("no answer");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

test("the bridge polls with the token, keeps the last list offline, and fills the store", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const store = new SessionStore();
  let now = 1_000_000;
  const hub: HubBridge = new HubBridge(() => store.setHub(hub.agents), {
    settings: () => hubSettings({ hubUrl: BASE }),
    token: () => ({ token: "tok", error: "" }),
    fetch: fakeFetch([{ status: 200, body: fixture() }, new Error("ECONNREFUSED")], seen),
    now: () => now,
  });
  hub.start();
  hub.stop();
  // start() ticks once; wait for that poll.
  for (let i = 0; i < 20 && !hub.snapshot().online; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen[0].url, BASE + "/api/desktop");
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, "Bearer tok");
  assert.equal(hub.snapshot().online, true);
  assert.equal(hub.snapshot().lastOkAt, now);
  const rows = store.merged();
  assert.equal(rows[0].key, "hub/dev-bss/export-csv#07");
  assert.equal(rows[0].source, "hub");
  assert.equal(rows[0].answerable, true);
  assert.equal(rows[1].answerable, false);
  assert.equal(rows[0].dialog?.question, "Do you want to run npm test?");
  assert.equal(store.herdrAgents.length, 3);

  now += 60_000;
  await hub.poll();
  const s = hub.snapshot();
  assert.equal(s.online, false);
  assert.equal(s.lastOkAt, 1_000_000);
  assert.match(s.error, /unreachable/);
  assert.equal(store.herdrAgents.length, 3);
  assert.equal(s.moves.length, 2);
});

test("no token: offline with the reason, nothing sent", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const hub = new HubBridge(() => undefined, {
    settings: () => hubSettings({ hubUrl: BASE }),
    token: () => ({ token: "", error: "no token in ~/.config/omarchy-dynamic-island/hub-token" }),
    fetch: fakeFetch([], seen),
  });
  hub.start();
  hub.stop();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen.length, 0);
  assert.match(hub.snapshot().error, /no token/);
});

test("a move runs only the path the hub gave for it, then polls again", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const hub = new HubBridge(() => undefined, {
    settings: () => hubSettings({ hubUrl: BASE }),
    token: () => ({ token: "tok", error: "" }),
    fetch: fakeFetch([{ status: 200, body: fixture() }, { status: 200, body: { ok: true } }, { status: 200, body: fixture() }], seen),
  });
  hub.start();
  hub.stop();
  for (let i = 0; i < 20 && !hub.snapshot().online; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await hub.runMove("task:42", "action"), { ok: true });
  assert.equal(seen[1].url, BASE + "/api/tasks/42/start");
  assert.equal(seen[1].init.method, "POST");
  await assert.rejects(hub.runMove("ask:dev-bss/export-csv#07", "action"), /only opens/);
  await assert.rejects(hub.runMove("nope", "later"), /no longer/);
});

test("asking the hub posts the question and follows up on the last one", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const hub = new HubBridge(() => undefined, {
    settings: () => hubSettings({ hubUrl: BASE }),
    token: () => ({ token: "tok", error: "" }),
    fetch: fakeFetch([
      { status: 200, body: fixture() },
      { status: 200, body: { id: 9, question: "q", answer: "Two tickets.", error: null } },
      { status: 409, body: { detail: "the day's questions are used up" } },
    ], seen),
  });
  hub.start();
  hub.stop();
  for (let i = 0; i < 20 && !hub.snapshot().online; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await hub.ask("what's blocking pythian?", null), { id: 9, answer: "Two tickets.", error: "" });
  assert.equal(seen[1].url, BASE + "/api/ask");
  assert.deepEqual(JSON.parse(String(seen[1].init.body)), { question: "what's blocking pythian?" });
  await assert.rejects(hub.ask("and bss?", 9), /409: the day's questions are used up/);
  assert.deepEqual(JSON.parse(String(seen[2].init.body)), { question: "and bss?", follow_up: 9 });
});

test("answering a dialog posts the option and the question to the row's answer path", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const hub = new HubBridge(() => undefined, {
    settings: () => hubSettings({ hubUrl: BASE }),
    token: () => ({ token: "tok", error: "" }),
    fetch: fakeFetch([
      { status: 200, body: fixture() },
      { status: 200, body: { ok: true } },
      { status: 200, body: fixture() },
      { status: 409, body: { detail: "the agent's dialog changed" } },
    ], seen),
  });
  hub.start();
  hub.stop();
  for (let i = 0; i < 20 && !hub.snapshot().online; i++) await new Promise((r) => setTimeout(r, 5));
  await hub.answer("hub/dev-bss/export-csv#07", 0);
  assert.equal(seen[1].url, BASE + "/api/boards/dev-bss:/home/daniel/app:export-csv/tickets/07/answer");
  assert.deepEqual(JSON.parse(String(seen[1].init.body)), { option: 0, question: "Do you want to run npm test?" });
  for (let i = 0; i < 20 && seen.length < 3; i++) await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(hub.answer("hub/dev-bss/export-csv#07", 2), /409: the agent's dialog changed/);
  await assert.rejects(hub.answer("hub/dev-bss/export-csv#07", 3), /not one of its options/);
  await assert.rejects(hub.answer("hub/dev-lanvera/itm-9909#03", 0), /no longer waiting/);
});
