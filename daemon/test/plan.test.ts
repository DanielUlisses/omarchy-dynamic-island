import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSdkRateLimit, parseClaudeRateLimits, parseCodexRateLimits, resetText, tier } from "../src/accounts/planMath.js";

const now = Date.UTC(2026, 9, 22, 12, 0, 0);

test("Claude status line limits: seconds become ms, over-limit is shown full", () => {
  const u = parseClaudeRateLimits({ five_hour: { used_percentage: 130, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 12.5, resets_at: now / 1000 + 86400 } }, now);
  assert.equal(u?.fiveHour?.usedPct, 100);
  assert.equal(u?.fiveHour?.resetsAt, now + 3600_000);
  assert.equal(u?.sevenDay?.usedPct, 12.5);
  assert.equal(parseClaudeRateLimits({}, now), null);
  assert.equal(parseClaudeRateLimits({ five_hour: { used_percentage: 900, resets_at: 1 } }, now), null);
});

test("Codex windows are sorted by length", () => {
  const u = parseCodexRateLimits({ rateLimits: {
    primary: { usedPercent: 40, resetsAt: now / 1000 + 600, windowDurationMins: 300 },
    secondary: { usedPercent: 70, resetsAt: now / 1000 + 6000, windowDurationMins: 10080 } } }, now);
  assert.equal(u?.fiveHour?.usedPct, 40);
  assert.equal(u?.sevenDay?.usedPct, 70);
});

test("SDK rate limit events merge into one window", () => {
  const u = mergeSdkRateLimit(undefined, { status: "allowed", utilization: 0.42, resetsAt: now / 1000 + 60, rateLimitType: "five_hour" }, now);
  assert.equal(Math.round(u!.fiveHour!.usedPct), 42);
});

test("colours and countdowns", () => {
  assert.equal(tier(null), "none");
  assert.equal(tier(49), "green");
  assert.equal(tier(80), "orange");
  assert.equal(tier(81), "red");
  assert.equal(resetText(now + (1 * 3600 + 42 * 60) * 1000, now), "Resets in 1h 42m");
  assert.equal(resetText(now + 5 * 60_000, now), "Resets in 5m");
  assert.equal(resetText(now + 3 * 86400_000 + 4 * 3600_000, now), "Resets in 3d 4h");
});
