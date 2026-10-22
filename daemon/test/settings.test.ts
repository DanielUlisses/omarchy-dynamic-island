import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HOOK_EVENTS, install, previousFile, uninstall, withHooks, withoutHooks } from "../src/cli/claudeSettings.js";

const CMD = "/home/me/.local/bin/island-hook";

test("installing twice leaves one island hook per event and keeps the user's own", () => {
  const user = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-guard" }] }] }, model: "opus" };
  const once = withHooks(user, CMD);
  const twice = withHooks(once, CMD);
  assert.deepEqual(once, twice);
  const pre = (twice.hooks as Record<string, unknown[]>).PreToolUse;
  assert.equal(pre.length, 2);
  for (const { event } of HOOK_EVENTS) assert.ok((twice.hooks as Record<string, unknown>)[event], event);
  assert.deepEqual(withoutHooks(twice), user);
});

test("install keeps the user's status line and uninstall puts everything back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "island-settings-"));
  const file = path.join(dir, "settings.json");
  const original = { statusLine: { type: "command", command: "~/bin/line.sh", padding: 0 }, theme: "dark" };
  fs.writeFileSync(file, JSON.stringify(original));
  install(dir, CMD, true);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.statusLine.command, `${CMD} --statusline`);
  assert.equal(after.statusLine.padding, 0);
  assert.equal(fs.readFileSync(previousFile(dir), "utf8").trim(), "~/bin/line.sh");
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("settings.json.island-backup-")));
  // A second install must not save our own command as "previous".
  install(dir, CMD, true);
  assert.equal(fs.readFileSync(previousFile(dir), "utf8").trim(), "~/bin/line.sh");
  uninstall(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), original);
  assert.equal(fs.existsSync(previousFile(dir)), false);
});

test("a settings file that is not JSON is never overwritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "island-settings-"));
  fs.writeFileSync(path.join(dir, "settings.json"), "{ nope");
  assert.throws(() => install(dir, CMD, true));
  assert.equal(fs.readFileSync(path.join(dir, "settings.json"), "utf8"), "{ nope");
});

test("install registers a profile per Claude login, once, and secretaryPath comes from shell.json", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "island-acc-"));
  const prev = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  try {
    const { registerClaudeProfiles, AccountManager, accountsPath } = await import("../src/accounts/accountManager.js");
    const out = registerClaudeProfiles([path.join(home, ".claude"), path.join(home, ".claude-pythian")]);
    assert.equal(out.length, 1);
    assert.match(out[0], /"pythian"/);
    assert.deepEqual(registerClaudeProfiles([path.join(home, ".claude-pythian")]), []);
    const saved = JSON.parse(fs.readFileSync(accountsPath(), "utf8"));
    assert.deepEqual(saved.profiles.map((p: { id: string }) => p.id), ["claude", "ollama", "pythian"]);
    assert.equal(saved.profiles[2].configDir, "~/.claude-pythian");

    const am = new AccountManager();
    assert.equal(am.secretaryPath(), path.join(home, "secretary"));
    fs.mkdirSync(path.join(home, ".config", "omarchy"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "omarchy", "shell.json"),
      JSON.stringify({ plugins: [{ id: "omarchy-dynamic-island", secretaryPath: "~/work/secretary" }] }));
    assert.equal(am.secretaryPath(), path.join(home, "work", "secretary"));
  } finally {
    process.env.HOME = prev.HOME;
    if (prev.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev.XDG_CONFIG_HOME;
  }
});
