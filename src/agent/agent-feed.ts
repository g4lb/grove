import type { AgentEvent } from "./events.ts";

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clip(v: string, n = 72): string {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** A short, Claude-Code-style `Tool(arg)` summary of a tool call for the live feed. */
export function describeToolUse(tool: string, input: unknown): string {
  const o = asRecord(input);
  let arg: string;
  switch (tool) {
    case "Bash":
      arg = clip(str(o.command));
      break;
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "Read":
      arg = str(o.file_path);
      break;
    case "NotebookEdit":
      arg = str(o.notebook_path);
      break;
    case "Glob":
    case "Grep":
      arg = clip(str(o.pattern));
      break;
    case "Skill":
      arg = str(o.command) || str(o.name) || str(o.skill);
      break;
    case "Task":
      arg = clip(str(o.description));
      break;
    case "WebFetch":
      arg = str(o.url);
      break;
    case "WebSearch":
      arg = clip(str(o.query));
      break;
    case "TodoWrite":
      arg = "";
      break;
    default: {
      const first = Object.values(o).find((v) => typeof v === "string" && v.trim().length > 0);
      arg = first ? clip(String(first)) : "";
    }
  }
  return arg ? `${tool}(${arg})` : tool;
}

/**
 * Render one agent event into human-readable feed lines (Claude-Code style):
 * tool calls and notices get a `· ` bullet; the agent's narration is shown as plain lines.
 * `usage` events carry no text — they feed the live status line, not the scrollback.
 */
export function renderAgentEvent(event: AgentEvent, emit: (line: string) => void): void {
  if (event.type === "token") {
    for (const raw of event.text.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (line.trim()) emit(line);
    }
  } else if (event.type === "tool_use") {
    emit(`● ${describeToolUse(event.tool, event.input)}`);
  } else if (event.type === "notice") {
    emit(`● ${event.message}`);
  } else if (event.type === "tool_result") {
    const lines = event.output.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;
    emit(`  ⎿ ${clip(lines[0]!)}`);
    const extra = lines.length - 1;
    if (extra > 0) emit(`     … +${extra} line${extra === 1 ? "" : "s"}`);
  }
}

/** Running usage/cost for the live status line. */
export interface SessionStats {
  contextTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  turns?: number;
}

/** Merge a usage event into the accumulated stats, overwriting only the fields it carries. */
export function mergeUsage(prev: SessionStats | null, e: SessionStats): SessionStats {
  const next: SessionStats = { ...(prev ?? {}) };
  if (e.contextTokens !== undefined) next.contextTokens = e.contextTokens;
  if (e.outputTokens !== undefined) next.outputTokens = e.outputTokens;
  if (e.costUsd !== undefined) next.costUsd = e.costUsd;
  if (e.turns !== undefined) next.turns = e.turns;
  return next;
}

function compact(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function fmtDuration(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * How to get the work out of an isolated task branch: review the diff, merge it, or open the
 * worktree. The branch lives in grove's worktree but shares your repo's git, so these run from
 * your repo. (grove stays local — no push/PR unless you do it.)
 */
export function branchActions(branch: string, worktreePath: string | null): string[] {
  const lines = [`  review: git diff HEAD..${branch}`, `  merge:  git merge ${branch}`];
  if (worktreePath) lines.push(`  open:   ${worktreePath}`);
  return lines;
}

/** A one-line `1m 8s · 14.2k ctx · 6 turns · $0.09` status, scaled to whatever fields are present. */
export function formatStats(s: SessionStats | null, elapsedSec?: number): string {
  const parts: string[] = [];
  if (elapsedSec !== undefined) parts.push(fmtDuration(elapsedSec));
  if (s?.contextTokens) parts.push(`${compact(s.contextTokens)} ctx`);
  if (s?.turns) parts.push(`${s.turns} turn${s.turns === 1 ? "" : "s"}`);
  if (s?.costUsd) parts.push(`$${s.costUsd.toFixed(s.costUsd < 0.01 ? 4 : 2)}`);
  return parts.join(" · ");
}
