// What island-hook prints back to the agent after a permission request.
//
// The rule that matters: nothing that allows anything is ever printed without
// a decision a human made. No decision prints nothing, and the agent then asks
// in its own terminal exactly as if the island were not there.

import { asObject, type Decision } from "../protocol.js";

/** Agents whose PermissionRequest takes Claude Code's hookSpecificOutput. */
export const takesDecisions = (agent: string): boolean => agent === "claude" || agent === "codex";

export function permissionReply(
  agent: string,
  decision: Decision | null,
  input: Record<string, unknown> | undefined,
  suggestions: unknown[] | undefined,
): string | null {
  if (!decision || !takesDecisions(agent)) return null;
  const out = (d: Record<string, unknown>) =>
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } });
  switch (decision.kind) {
    case "allow":
      return out({ behavior: "allow" });
    case "always_allow":
      // Claude Code's own "don't ask again" rules for this request, when it
      // offered some; the island remembers the tool for the session either way.
      return out(Array.isArray(suggestions) && suggestions.length > 0 && agent === "claude"
        ? { behavior: "allow", updatedPermissions: suggestions }
        : { behavior: "allow" });
    case "deny":
      return out({ behavior: "deny", message: decision.message || "Denied from the Omarchy island" });
    case "answer":
      // AskUserQuestion: the same input with the answers added.
      if (agent !== "claude" || !input) return null;
      return out({ behavior: "allow", updatedInput: { ...input, answers: decision.answers } });
    default:
      return null;
  }
}

/** The last lines a Bash call printed (stdout, then stderr), at most 800 chars. */
export function outputTail(response: unknown): string | undefined {
  const r = asObject(response);
  const text = r ? [r.stdout, r.stderr].filter((x) => typeof x === "string" && x).join("\n") : typeof response === "string" ? response : "";
  if (!text) return undefined;
  const lines = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd().split("\n").slice(-8).join("\n");
  return lines.length > 800 ? lines.slice(-800) : lines;
}
