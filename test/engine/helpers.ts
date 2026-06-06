import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { FakeAgentRunner, type PhaseScript } from "../../src/agent/fake-agent-runner.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import type { TaskInfra, TaskProvisionResult } from "../../src/engine/task-infra.ts";
import type { Phase } from "../../src/domain/types.ts";
import type { AgentEvent, PhaseResult } from "../../src/agent/events.ts";

export class FakeTaskInfra implements TaskInfra {
  provisioned: string[] = [];
  toreDown: Array<{ taskId: string; worktreePath: string }> = [];
  constructor(private composeStarted = false) {}
  async provision(taskId: string, _title: string): Promise<TaskProvisionResult> {
    this.provisioned.push(taskId);
    return {
      worktree: { taskId, worktreePath: "/wt", branch: `grove/${taskId}` },
      composeStarted: this.composeStarted,
    };
  }
  async teardown(taskId: string, worktreePath: string): Promise<void> {
    this.toreDown.push({ taskId, worktreePath });
  }
}

/** A successful phase script (optionally with events + an artifact path). */
export function ok(phase: Phase, artifactPath: string | null = null, events: AgentEvent[] = []): PhaseScript {
  const result: PhaseResult = {
    success: true,
    summary: `${phase} done`,
    artifactPath,
    costUsd: 0,
    sessionId: "s",
  };
  return { events, result };
}

/** A failed phase script. */
export function fail(phase: Phase): PhaseScript {
  const result: PhaseResult = {
    success: false,
    summary: `${phase} failed`,
    artifactPath: null,
    costUsd: 0,
    sessionId: "s",
  };
  return { events: [], result };
}

export function buildEngine(
  scripts: Partial<Record<Phase, PhaseScript>>,
  opts: { infra?: FakeTaskInfra } = {},
) {
  const store = SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
  const agent = new FakeAgentRunner(scripts);
  const infra = opts.infra ?? new FakeTaskInfra();
  const engine = new TaskEngine({ store, agent, infra, model: "claude-opus-4-8", now: () => "2026-06-06T00:00:00.000Z" });
  return { store, agent, infra, engine };
}
