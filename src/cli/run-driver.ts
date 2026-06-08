import type { Task } from "../domain/types.ts";
import type { AgentEvent } from "../agent/events.ts";
import { renderAgentEvent, mergeUsage, formatStats, branchActions, type SessionStats } from "../agent/agent-feed.ts";
import type { StartTaskInput } from "../engine/task-engine.ts";
import type { DiskMonitor, DiskThresholds } from "../infra/disk-monitor.ts";
import type { GrovePaths } from "../config/paths.ts";

/** The narrow engine surface the driver needs (the real TaskEngine satisfies it). */
export interface RunEngine {
  startTask(input: StartTaskInput, onEvent?: (event: AgentEvent) => void): Promise<Task>;
}

export interface RunDeps {
  engine: RunEngine;
  disk: Pick<DiskMonitor, "freeBytes" | "evaluate">;
  thresholds: DiskThresholds;
  paths: GrovePaths;
  repoPath: string;
  hasCredential: boolean;
  hasClaudeRuntime: boolean;
  isGitRepo: boolean;
  /** Absolute path to the resolved superpowers plugin directory. */
  superpowersPath: string;
  out: (line: string) => void;
}

export interface RunResult {
  ok: boolean;
  taskId?: string;
  status?: string;
  message: string;
}

export async function runTask(prose: string, deps: RunDeps): Promise<RunResult> {
  // 1. Prechecks — fail before provisioning.
  if (!deps.hasCredential) {
    return { ok: false, message: "no Anthropic credential — run `claude login`, or set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)" };
  }
  if (!deps.hasClaudeRuntime) {
    return { ok: false, message: "claude runtime not installed — run `grove install-runtime`" };
  }
  if (!deps.isGitRepo) {
    return { ok: false, message: "not a git repository — run grove from inside your project" };
  }
  if (!deps.superpowersPath) {
    return { ok: false, message: "superpowers skills unavailable — check your network and retry" };
  }

  // 2. Disk gate.
  const free = await deps.disk.freeBytes(deps.paths.root);
  const verdict = deps.disk.evaluate(free, deps.thresholds);
  if (verdict === "block") {
    return { ok: false, message: "not enough free disk space to provision — reclaim space with `grove gc`" };
  }
  if (verdict === "warn") {
    deps.out("⚠ low disk space — proceeding, but consider `grove gc`");
  }

  // 3. Run one autonomous session, accumulating usage for a final stats line.
  let stats: SessionStats | null = null;
  const onEvent = (event: AgentEvent): void => {
    if (event.type === "usage") {
      stats = mergeUsage(stats, event);
      return;
    }
    renderAgentEvent(event, (line) => deps.out(`  ${line}`));
  };
  const task = await deps.engine.startTask(
    { title: prose, description: prose, repoPath: deps.repoPath, kind: "task", superpowersPath: deps.superpowersPath },
    onEvent,
  );

  // 4. Terminal — report the outcome + how to get the work out of the isolated branch.
  const s = formatStats(stats);
  const tail = s ? ` · ${s}` : "";
  if (task.status === "done") {
    const lines = [`done — branch ${task.branch ?? "?"} is ready${tail}`, ...branchActions(task.branch ?? "?", task.worktreePath)];
    return { ok: true, taskId: task.id, status: "done", message: lines.join("\n") };
  }
  if (task.status === "blocked") {
    const extra = task.branch ? branchActions(task.branch, task.worktreePath) : [];
    const lines = [`blocked — the session did not complete${tail}`, ...extra];
    return { ok: false, taskId: task.id, status: "blocked", message: lines.join("\n") };
  }
  return { ok: true, taskId: task.id, status: task.status, message: task.status };
}
