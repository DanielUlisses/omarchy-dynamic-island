// Line diffs for the island's live diff tracker. A finished Edit, MultiEdit
// or Write is turned into unified hunks with `+N -M` counts. Big inputs are
// not diffed (quadratic), only counted, and say so with `tooLarge`.

export type LineKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** 1-based line numbers; -1 where the line does not exist on that side. */
  oldLine: number;
  newLine: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  id: number;
  path: string;
  tool: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  tooLarge: boolean;
  isNewFile: boolean;
  at: number;
}

export const MAX_BYTES = 200 * 1024;
export const MAX_LINES = 4000;
const MAX_CELLS = 1_000_000;
const CONTEXT = 3;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `+N -M` without building hunks: what differs once a shared head and tail are set aside. */
function countOnly(oldLines: string[], newLines: string[]): { added: number; removed: number } {
  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
  let tail = 0;
  while (tail < oldLines.length - head && tail < newLines.length - head
    && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
  return { added: newLines.length - head - tail, removed: oldLines.length - head - tail };
}

/** LCS walk -> flat list of lines, each kept, added or removed. */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const m = a.length, n = b.length;
  const w = n + 1;
  const table = new Uint32Array((m + 1) * w);
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1
        : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: "context", text: a[i], oldLine: i + 1, newLine: j + 1 }); i++; j++; }
    else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) { out.push({ kind: "removed", text: a[i], oldLine: i + 1, newLine: -1 }); i++; }
    else { out.push({ kind: "added", text: b[j], oldLine: -1, newLine: j + 1 }); j++; }
  }
  for (; i < m; i++) out.push({ kind: "removed", text: a[i], oldLine: i + 1, newLine: -1 });
  for (; j < n; j++) out.push({ kind: "added", text: b[j], oldLine: -1, newLine: j + 1 });
  return out;
}

/** Changed lines with CONTEXT lines around them; nearby changes share a hunk. */
export function buildHunks(flat: DiffLine[], context = CONTEXT): DiffHunk[] {
  const changed = flat.map((l, idx) => (l.kind === "context" ? -1 : idx)).filter((x) => x >= 0);
  if (changed.length === 0) return [];
  const hunks: DiffHunk[] = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(flat.length - 1, changed[0] + context);
  const flush = () => {
    const lines = flat.slice(start, end + 1);
    const firstOld = lines.find((l) => l.oldLine > 0)?.oldLine ?? 0;
    const firstNew = lines.find((l) => l.newLine > 0)?.newLine ?? 0;
    hunks.push({ oldStart: firstOld, newStart: firstNew, lines });
  };
  for (let k = 1; k < changed.length; k++) {
    const idx = changed[k];
    if (idx - context <= end + 1) end = Math.min(flat.length - 1, idx + context);
    else { flush(); start = Math.max(0, idx - context); end = Math.min(flat.length - 1, idx + context); }
  }
  flush();
  return hunks;
}

type Partial_ = Omit<FileDiff, "id" | "at" | "tool">;

export function fromEdit(oldText: string, newText: string, path: string): Partial_ {
  const a = splitLines(oldText), b = splitLines(newText);
  const big = oldText.length + newText.length > MAX_BYTES || a.length + b.length > MAX_LINES || a.length * b.length > MAX_CELLS;
  if (big) return { path, ...countOnly(a, b), hunks: [], tooLarge: true, isNewFile: false };
  const flat = diffLines(a, b);
  return {
    path,
    added: flat.filter((l) => l.kind === "added").length,
    removed: flat.filter((l) => l.kind === "removed").length,
    hunks: buildHunks(flat),
    tooLarge: false,
    isNewFile: false,
  };
}

export function fromNew(content: string, path: string): Partial_ {
  const lines = splitLines(content);
  if (content.length > MAX_BYTES || lines.length > MAX_LINES)
    return { path, added: lines.length, removed: 0, hunks: [], tooLarge: true, isNewFile: true };
  const diff = lines.map((text, k): DiffLine => ({ kind: "added", text, oldLine: -1, newLine: k + 1 }));
  return { path, added: lines.length, removed: 0, hunks: diff.length ? [{ oldStart: 0, newStart: 1, lines: diff }] : [], tooLarge: false, isNewFile: true };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The diff a finished file tool made, from its PostToolUse `tool_input`, or
 * null for any other tool. MultiEdit's edits are diffed one by one and merged.
 */
export function fromToolInput(tool: string, input: Record<string, unknown> | undefined): Partial_ | null {
  if (!input) return null;
  const path = str(input.file_path) || str(input.path) || str(input.notebook_path);
  if (!path) return null;
  if (tool === "Write") return fromNew(str(input.content), path);
  if (tool === "Edit") return fromEdit(str(input.old_string), str(input.new_string), path);
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const parts = input.edits.map((e) => {
      const edit = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      return fromEdit(str(edit.old_string), str(edit.new_string), path);
    });
    return {
      path,
      added: parts.reduce((s, p) => s + p.added, 0),
      removed: parts.reduce((s, p) => s + p.removed, 0),
      hunks: parts.flatMap((p) => p.hunks),
      tooLarge: parts.some((p) => p.tooLarge),
      isNewFile: false,
    };
  }
  return null;
}

/** As unified diff text (for the chat agent, or `git apply`-style viewing). */
export function toUnified(d: FileDiff): string {
  const out = [`--- ${d.isNewFile ? "/dev/null" : "a/" + d.path}`, `+++ b/${d.path}`];
  for (const h of d.hunks) {
    const oldCount = h.lines.filter((l) => l.kind !== "added").length;
    const newCount = h.lines.filter((l) => l.kind !== "removed").length;
    out.push(`@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@`);
    for (const l of h.lines) out.push((l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " ") + l.text);
  }
  if (d.tooLarge) out.push(`# too large to diff: +${d.added} -${d.removed}`);
  return out.join("\n");
}
