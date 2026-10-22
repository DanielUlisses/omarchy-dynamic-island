import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("meetings are listed newest first with their title, and deleted", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "island-meetings-"));
  process.env.XDG_DATA_HOME = data;
  const { listMeetings, deleteMeeting, meetingsDir } = await import("../src/meetings/meetings.js");
  const dir = meetingsDir();
  // A meetingsDir set in the real shell.json would win over XDG_DATA_HOME.
  if (!dir.startsWith(data)) return;
  fs.mkdirSync(dir, { recursive: true });
  const write = (id: string, title: string, mtime: number, summary: boolean) => {
    const f = path.join(dir, `${id}.transcript.md`);
    fs.writeFileSync(f, `# ${title}\n\n## Meeting Info\n\n- **Duration:** 5m 2s\n- **Word Count:** 321\n`);
    fs.utimesSync(f, mtime / 1000, mtime / 1000);
    if (summary) fs.writeFileSync(path.join(dir, `${id}.summary.md`), "## Summary\n");
  };
  write("2026-10-21-0900-Standup", "Standup", Date.now() - 86_400_000, true);
  write("2026-10-22-0900-Standup", "Standup", Date.now(), false);
  const rows = listMeetings();
  assert.deepEqual(rows.map((r) => r.id), ["2026-10-22-0900-Standup", "2026-10-21-0900-Standup"]);
  assert.equal(rows[0].title, "Standup");
  assert.equal(rows[0].duration, "5m 2s");
  assert.equal(rows[0].words, 321);
  assert.deepEqual(rows.map((r) => r.hasSummary), [false, true]);
  assert.equal(await deleteMeeting("2026-10-21-0900-Standup"), true);
  assert.equal(listMeetings().length, 1);
  assert.equal(await deleteMeeting("../etc/passwd"), false);
  fs.rmSync(data, { recursive: true, force: true });
});
