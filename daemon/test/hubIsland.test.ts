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
