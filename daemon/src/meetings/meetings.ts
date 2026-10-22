// The meetings the island transcribed (sources/Transcription.qml writes them):
// <date>-<time>-<title>.transcript.md and .summary.md, plus a .meta.json that
// remembers the title and voxtype's own id for the meeting.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { islandSettings } from "../shellSettings.js";

export interface MeetingRow {
  /** File name without extension; also the id the other calls take. */
  id: string;
  title: string;
  /** ms since the epoch (the transcript file's mtime). */
  date: number;
  duration: string;
  words: number;
  hasSummary: boolean;
  transcript: string;
  summary: string;
}

/** Where the island saves transcribed meetings. */
export function meetingsDir(): string {
  const set = String(islandSettings().meetingsDir ?? "").replace(/^~(?=\/|$)/, os.homedir());
  return set || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "omarchy-dynamic-island", "meetings");
}

const ID = /^[A-Za-z0-9._-]{1,160}$/;
const field = (text: string, name: string): string => new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`).exec(text)?.[1]?.trim() ?? "";

export function listMeetings(): MeetingRow[] {
  const dir = meetingsDir();
  let names: string[];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".transcript.md")); } catch { return []; }
  const rows: MeetingRow[] = [];
  for (const n of names) {
    const id = n.replace(/\.transcript\.md$/, "");
    const transcript = path.join(dir, n);
    const summary = path.join(dir, id + ".summary.md");
    let head = "";
    try { head = fs.readFileSync(transcript, "utf8").slice(0, 1500); } catch { continue; }
    let title = /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? "";
    try { title = String(JSON.parse(fs.readFileSync(path.join(dir, id + ".meta.json"), "utf8")).title || title); } catch { /* no sidecar */ }
    rows.push({
      id, title: title || "Meeting", date: fs.statSync(transcript).mtimeMs, duration: field(head, "Duration"),
      words: Number(field(head, "Word Count")) || 0, hasSummary: fs.existsSync(summary) && fs.statSync(summary).size > 0, transcript, summary,
    });
  }
  return rows.sort((a, b) => b.date - a.date);
}

/** Deletes a meeting's files and, best effort, voxtype's own copy of it. */
export async function deleteMeeting(id: string): Promise<boolean> {
  if (!ID.test(id)) return false;
  const dir = meetingsDir();
  let voxtype = "";
  try { voxtype = String(JSON.parse(fs.readFileSync(path.join(dir, id + ".meta.json"), "utf8")).voxtype || ""); } catch { /* no sidecar */ }
  let removed = false;
  for (const ext of ["transcript.md", "summary.md", "meta.json"]) {
    try { fs.rmSync(path.join(dir, `${id}.${ext}`)); removed = true; } catch { /* already gone */ }
  }
  if (/^[0-9a-f-]{36}$/.test(voxtype))
    await new Promise<void>((resolve) => execFile("voxtype", ["meeting", "delete", voxtype, "--force"], { timeout: 15_000 }, () => resolve()));
  return removed;
}
