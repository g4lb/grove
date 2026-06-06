import { join } from "node:path";
import type { Task, TaskKind } from "../domain/types.ts";
import type { AgentEvent } from "../agent/events.ts";
import type { StartTaskInput, GateDecision } from "../engine/task-engine.ts";
import type { Router } from "../engine/router.ts";
import type { DiskMonitor, DiskThresholds } from "../infra/disk-monitor.ts";
import type { GrovePaths } from "../config/paths.ts";
import { phaseDefinition } from "../agent/phases.ts";

/** The narrow engine surface the driver needs (the real TaskEngine satisfies it). */
export interface RunEngine {
  startTask(input: StartTaskInput): Promise<Task>;
  confirmGate(taskId: string, decision: GateDecision): Promise<Task>;
  subscribe(taskId: string, handler: (event: AgentEvent) => void): () => void;
}

export interface RunDeps {
  engine: RunEngine;
  router: Router;
  disk: Pick<DiskMonitor, "freeBytes" | "evaluate">;
  thresholds: DiskThresholds;
  paths: GrovePaths;
  repoPath: string;
  hasCredential: boolean;
  isGitRepo: boolean;
  yes: boolean;
  decide: (gate: { task: Task; artifactPath: string | null }) => Promise<GateDecision>;
  out: (line: string) => void;
}

export interface RunResult {
  ok: boolean;
  taskId?: string;
  status?: string;
  message: string;
}

/** Absolute path of the gate artifact for a task's current phase, or null. */
function artifactFor(task: Task): string | null {
  if (!task.worktreePath) return null;
  const rel = phaseDefinition(task.currentPhase).artifactRelPath;
  return rel ? join(task.worktreePath, rel) : null;
}

export async function runTask(prose: string, deps: RunDeps): Promise<RunResult> {
  // 1. Prechecks — fail before provisioning.
  if (!deps.hasCredential) {
    return { ok: false, message: "no Anthropic credential — set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)" };
  }
  if (!deps.isGitRepo) {
    return { ok: false, message: "not a git repository — run grove from inside your project" };
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

  // 3. Classify.
  const routed = await deps.router.classify(prose);
  deps.out(`detected: ${routed.kind} (${routed.reasoning})`);
  const kind: TaskKind = routed.kind === "debug" ? "issue" : "task";
  if (routed.kind === "debug") {
    deps.out("debugging is coming in v1.1 — running this as a task for now");
  }

  // 4. Start + drive gates.
  let task = await deps.engine.startTask({ title: prose, repoPath: deps.repoPath, kind });
  const off = deps.engine.subscribe(task.id, (event) => {
    if (event.type === "tool_use") deps.out(`  · ${event.tool}`);
    else if (event.type === "notice") deps.out(`  · ${event.message}`);
  });
  try {
    deps.out(`phase ${task.currentPhase}: ${task.status}`);
    while (task.status === "waiting_confirm") {
      const artifactPath = artifactFor(task);
      deps.out(`gate — ${task.currentPhase} done${artifactPath ? ` (see ${artifactPath})` : ""}`);
      const decision: GateDecision = deps.yes ? { kind: "approve" } : await deps.decide({ task, artifactPath });
      task = await deps.engine.confirmGate(task.id, decision);
      deps.out(`phase ${task.currentPhase}: ${task.status}`);
      if (decision.kind === "stop") break;
    }
  } finally {
    off();
  }

  // 5. Terminal.
  if (task.status === "done") return { ok: true, taskId: task.id, status: "done", message: "task complete" };
  if (task.status === "blocked") return { ok: false, taskId: task.id, status: "blocked", message: `blocked at ${task.currentPhase}` };
  if (task.status === "stopped") return { ok: true, taskId: task.id, status: "stopped", message: `stopped at ${task.currentPhase}` };
  return { ok: true, taskId: task.id, status: task.status, message: task.status };
}
