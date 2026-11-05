import assert from "node:assert/strict";
import { test } from "node:test";
import { islandModel } from "./islandModel.js";

const M = islandModel();
const BASE = "https://tk-hub.example.ts.net";

test("hub agents toast when blocked, and as done only at a hub milestone", () => {
  const prev = { "hub/a": "working", "hub/b": "working", "hub/c": "working", "local/w1:p1": "working" };
  const agents = [
    { key: "hub/a", source: "hub", status: "idle" },
    { key: "hub/b", source: "hub", status: "done" },
    { key: "hub/c", source: "hub", status: "blocked" },
    { key: "local/w1:p1", status: "idle" },
  ];
  const kinds = Array.from(M.herdrChanges(prev, agents, true) as Array<{ agent: { key: string }; kind: string }>).map((e: { agent: { key: string }; kind: string }) => e.agent.key + ":" + e.kind);
  assert.deepEqual(kinds, ["hub/b:done", "hub/c:blocked", "local/w1:p1:done"]);
});

test("a dialog reads as its question and numbered options", () => {
  assert.equal(M.hubDialogText({ question: "Which date format?", options: ["ISO", "Locale"] }), "Which date format?\n1. ISO\n2. Locale");
  assert.equal(M.hubDialogText(null), "");
});

test("only pages on the configured hub open", () => {
  assert.equal(M.hubLink(BASE + "/#/today", BASE), BASE + "/#/today");
  assert.equal(M.hubLink(BASE + "/#/today", BASE + "/"), BASE + "/#/today");
  assert.equal(M.hubLink("https://tk-hub.example.ts.net.evil.com/#/x", BASE), "");
  assert.equal(M.hubLink(BASE + "/x", ""), "");
});

test("Chrome notifications from a quiet origin are recognised", () => {
  const quiet = ["claude.ai"];
  assert.equal(M.quietOrigin("Google Chrome", "", "Claude\n<a href=\"https://claude.ai/\">claude.ai</a>\n\nYour task is done", quiet), true);
  assert.equal(M.quietOrigin("Chromium", "", "code.claude.ai\nDone", quiet), true);
  assert.equal(M.quietOrigin("Google Chrome", "", "mail.google.com\nNew mail about claude", quiet), false);
  assert.equal(M.quietOrigin("Google Chrome", "", "notclaude.ai\nhi", quiet), false);
  assert.equal(M.quietOrigin("Slack", "", "claude.ai\nhi", quiet), false);
  assert.equal(M.quietOrigin("Google Chrome", "", "claude.ai", []), false);
});

test("an opened next move shows its card", () => {
  assert.equal(M.viewFor({ userExpanded: true, moveOpen: true }), "move-expanded");
  assert.equal(M.viewFor({ userExpanded: false, moveOpen: true, hovered: false }), "idle");
  assert.equal(M.sizeFor("move-expanded", {}, null).w, 424);
});

test("hub mode: #07, a board or a page jumps; anything else is a question", () => {
  const agents = [
    { source: "hub", nn: "07", project: "export-csv", status: "working", title: "CSV", url: BASE + "/#/ticket/a/07" },
    { source: "hub", nn: "07", project: "receipts", status: "blocked", title: "Receipts", url: BASE + "/#/ticket/b/07" },
    { source: "hub", nn: "03", project: "receipts", status: "done", title: "Fmt", url: BASE + "/#/ticket/b/03" },
    { nn: "", project: "local", status: "working", url: "" },
  ];
  const meetings = [{ project: "itm-9909" }];
  const url = (t: string) => M.hubJump(t, agents, meetings, BASE)?.url ?? null;
  assert.equal(url("#07"), BASE + "/#/ticket/b/07");
  assert.equal(url("#7"), BASE + "/#/ticket/b/07");
  assert.equal(url("export-csv#07"), BASE + "/#/ticket/a/07");
  assert.equal(url("#99"), null);
  assert.equal(url("receipts"), BASE + "/#/ticket/b/07");
  assert.equal(url("open Today"), BASE + "/#/today");
  assert.equal(url("live board"), BASE + "/#/live");
  assert.equal(url("itm-9909"), BASE + "/#/projects");
  assert.equal(url("what's blocking pythian?"), null);
  assert.equal(M.hubJump("#07", agents, meetings, ""), null);
});

test("a calendar event matches the hub's meeting by UID and start", () => {
  const start = Date.parse("2026-11-05T15:00:00Z");
  const meetings = [
    { id: 123, uid: "abc@google.com", start, capture: true, title: "BSS weekly" },
    { id: 130, uid: "abc@google.com", start: start + 7 * 86400000, capture: false },
  ];
  assert.equal(M.hubMeetingFor({ uid: "abc@google.com", start }, meetings)?.id, 123);
  assert.equal(M.hubMeetingFor({ uid: "abc@google.com", start: start + 7 * 86400000 }, meetings)?.id, 130);
  assert.equal(M.hubMeetingFor({ uid: "abc@google.com", start: start + 3600000 }, meetings), null);
  assert.equal(M.hubMeetingFor({ uid: "", start }, meetings), null);
  assert.equal(M.captureRequest(meetings[0], "/m/x.transcript.md"),
    'Run the call-capture skill for tk-hub meeting 123 ("BSS weekly"). The transcript is at /m/x.transcript.md.');
});
