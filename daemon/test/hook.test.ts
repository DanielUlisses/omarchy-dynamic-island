import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionReply } from "../src/cli/hookReply.js";
import { parsePoll } from "../src/herdr/herdrBridge.js";
import { parseDecision } from "../src/server.js";
import { answersFit, SessionStore } from "../src/store/sessionStore.js";

test("nothing is allowed without a decision", () => {
  for (const agent of ["claude", "codex", "gemini", "opencode"]) assert.equal(permissionReply(agent, null, {}, []), null);
  assert.equal(permissionReply("gemini", { kind: "allow" }, {}, []), null);
  const allow = JSON.parse(permissionReply("claude", { kind: "allow" }, {}, [])!);
  assert.equal(allow.hookSpecificOutput.decision.behavior, "allow");
  const deny = JSON.parse(permissionReply("codex", { kind: "deny" }, {}, [])!);
  assert.equal(deny.hookSpecificOutput.decision.behavior, "deny");
  const always = JSON.parse(permissionReply("claude", { kind: "always_allow" }, {}, [{ type: "addRules" }])!);
  assert.deepEqual(always.hookSpecificOutput.decision.updatedPermissions, [{ type: "addRules" }]);
});

test("question answers go back as the same input plus answers, and must fit", () => {
  const input = { questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }], multiSelect: false }] };
  const out = JSON.parse(permissionReply("claude", { kind: "answer", answers: { "Which?": "B" } }, input, undefined)!);
  assert.deepEqual(out.hookSpecificOutput.decision.updatedInput.answers, { "Which?": "B" });
  const q = [{ question: "Which?", options: [{ label: "A" }, { label: "B" }], multiSelect: false }];
  assert.equal(answersFit(q, { "Which?": "C" }), false);
  assert.equal(answersFit(q, { "Which?": "A" }), true);
  assert.deepEqual(parseDecision({ answers: { "Which?": "A" } }), { kind: "answer", answers: { "Which?": "A" } });
  assert.equal(parseDecision("maybe"), null);
});

test("herdr poll output parses into agents; a silent machine is reported", () => {
  const out = "@@HERDR local - default\n" + JSON.stringify({ result: { agents: [{ pane_id: "w1:p2", agent: "claude", agent_status: "blocked", cwd: "/x/repo--feature", terminal_title: "Fix <b>it</b>" }] } }) +
    "\n@@HERDR bss ssh://me@bss default bss\nnot json\n";
  const r = parsePoll(out);
  assert.equal(r.agents.length, 1);
  assert.equal(r.agents[0].key, "local/w1:p2");
  assert.equal(r.agents[0].project, "repo");
  assert.equal(r.agents[0].title, "Fix it");
  assert.deepEqual(r.failed, ["bss"]);
});

test("hook sessions merge into their herdr pane and a pending approval wins", async () => {
  const store = new SessionStore();
  store.setHerdr([{ key: "local/w1:p2", machine: "", target: "", session: "default", label: "", pane: "w1:p2", agent: "claude", status: "working", title: "t", project: "repo", cwd: "/x/repo" }]);
  store.ingest({ hook_event_name: "PostToolUse", session_id: "s1", cwd: "/x/repo", tool_name: "Edit", tool_input: { file_path: "/x/repo/a.ts", old_string: "a", new_string: "b\nc" }, island: { agent: "claude", herdrPane: "w1:p2" } });
  let m = store.merged();
  assert.equal(m.length, 1);
  assert.equal(m[0].added, 2);
  assert.equal(m[0].removed, 1);
  const { id, decision } = store.requestApproval({ source: "hook", sessionId: "s1", agent: "claude", project: "repo", herdrPane: "w1:p2", tool: "Bash", input: { command: "rm -rf build" } });
  m = store.merged();
  assert.equal(m[0].status, "blocked");
  assert.equal(store.approvals()[0].summary, "rm -rf build");
  assert.ok(store.decide(id, { kind: "always_allow" }));
  assert.deepEqual(await decision, { kind: "always_allow" });
  assert.ok(store.isAlwaysAllowed("s1", "Bash"));
  assert.equal(store.approvals().length, 0);
});

test("a turn's tool calls become steps, and Bash leaves its output tail", async () => {
  const { outputTail } = await import("../src/cli/hookReply.js");
  assert.equal(outputTail({ stdout: "a\nb\n\u001b[32mPASS\u001b[0m tests\n", stderr: "" }), "a\nb\nPASS tests");
  assert.equal(outputTail(undefined), undefined);
  const store = new SessionStore();
  const base = { session_id: "s2", cwd: "/x/app", island: { agent: "claude" as const } };
  store.ingest({ ...base, hook_event_name: "UserPromptSubmit", prompt: "fix tva" });
  store.ingest({ ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/x/app/invoice.ts" } });
  store.ingest({ ...base, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/x/app/invoice.ts" } });
  store.ingest({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
  let m = store.merged()[0];
  assert.deepEqual(m.steps.map((s) => `${s.tool}:${s.state}`), ["Read:done", "Bash:running"]);
  store.ingest({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, island: { agent: "claude", output: "Tests: 48 passed" } });
  store.ingest({ ...base, hook_event_name: "Stop" });
  m = store.merged()[0];
  assert.equal(m.status, "done");
  assert.deepEqual(m.terminal && [m.terminal.command, m.terminal.output], ["npm test", "Tests: 48 passed"]);
  assert.ok(m.steps.every((s) => s.state === "done"));
});
