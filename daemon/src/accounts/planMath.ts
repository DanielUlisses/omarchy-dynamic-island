// Plan usage arithmetic: Claude Code's `rate_limits` (handed to its status
// line command on stdin), Codex's `account/rateLimits/read`, and the Agent
// SDK's rate_limit_event all turn into the same two windows.

import { asObject, isNum } from "../protocol.js";

export interface PlanWindow {
  /** 0–100. */
  usedPct: number;
  /** Epoch milliseconds. */
  resetsAt: number;
}

export interface PlanUsage {
  fiveHour?: PlanWindow;
  sevenDay?: PlanWindow;
  updatedAt: number;
}

const DAY_MS = 86_400_000;

/** Epoch seconds or milliseconds -> milliseconds; null if it is not a plausible reset time. */
function epochMs(v: number, now: number): number | null {
  if (v <= 0) return null;
  const ms = v * 1000 > now + 400 * DAY_MS ? v : v * 1000;
  return ms > now + 400 * DAY_MS ? null : ms;
}

function claudeWindow(raw: unknown, now: number): PlanWindow | undefined {
  const w = asObject(raw);
  const pct = w?.used_percentage ?? w?.utilization;
  const reset = w?.resets_at;
  if (!isNum(pct) || pct < 0 || pct > 200) return undefined;
  const at = isNum(reset) ? epochMs(reset, now) : typeof reset === "string" ? Date.parse(reset) : null;
  if (at === null || !Number.isFinite(at)) return undefined;
  return { usedPct: Math.min(100, pct), resetsAt: at };
}

/** Claude Code's status line `rate_limits`, or null when it holds neither window (API-key sessions). */
export function parseClaudeRateLimits(raw: unknown, now = Date.now()): PlanUsage | null {
  const rl = asObject(raw);
  const fiveHour = claudeWindow(rl?.five_hour, now);
  const sevenDay = claudeWindow(rl?.seven_day, now);
  if (!fiveHour && !sevenDay) return null;
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), updatedAt: now };
}

/** Codex `account/rateLimits/read`: primary/secondary sorted into windows by their length. */
export function parseCodexRateLimits(result: unknown, now = Date.now()): PlanUsage | null {
  const limits = asObject(asObject(result)?.rateLimits);
  if (!limits) return null;
  const usage: PlanUsage = { updatedAt: now };
  for (const key of ["primary", "secondary"]) {
    const w = asObject(limits[key]);
    if (!w || !isNum(w.usedPercent) || !isNum(w.resetsAt)) continue;
    const at = epochMs(w.resetsAt, now);
    if (at === null) continue;
    const win = { usedPct: Math.min(100, Math.max(0, w.usedPercent)), resetsAt: at };
    if (isNum(w.windowDurationMins) && w.windowDurationMins <= 24 * 60) usage.fiveHour = win;
    else usage.sevenDay = win;
  }
  return usage.fiveHour || usage.sevenDay ? usage : null;
}

/** One Agent SDK rate_limit_event, merged into what is known. utilization is 0–1. */
export function mergeSdkRateLimit(prev: PlanUsage | undefined, info: unknown, now = Date.now()): PlanUsage | null {
  const i = asObject(info);
  if (!i || !isNum(i.utilization) || !isNum(i.resetsAt)) return null;
  const at = epochMs(i.resetsAt, now);
  if (at === null) return null;
  const pct = i.utilization <= 1 ? i.utilization * 100 : i.utilization;
  const win = { usedPct: Math.min(100, Math.max(0, pct)), resetsAt: at };
  const next: PlanUsage = { ...(prev ?? {}), updatedAt: now };
  if (i.rateLimitType === "five_hour") next.fiveHour = win;
  else if (i.rateLimitType === "seven_day") next.sevenDay = win;
  else return null;
  return next;
}

/** A window's share, 0 once its reset time has passed. */
export const effectivePct = (w: PlanWindow | undefined, now = Date.now()): number | null =>
  w ? (w.resetsAt <= now ? 0 : w.usedPct) : null;

/** Green below 50 %, orange to 80 %, red above. */
export function tier(pct: number | null): "none" | "green" | "orange" | "red" {
  if (pct === null) return "none";
  return pct < 50 ? "green" : pct <= 80 ? "orange" : "red";
}

/** "Resets in 1h 42m", "Resets in 12m", "Resets in 3d 4h". */
export function resetText(resetsAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((resetsAt - now) / 1000));
  if (s <= 0) return "Resetting…";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `Resets in ${d}d ${h}h`;
  if (h > 0) return `Resets in ${h}h ${m}m`;
  return `Resets in ${Math.max(1, m)}m`;
}
