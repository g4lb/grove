import type { Store } from "../store/store.ts";
import type { Task, TaskKind, Phase } from "../domain/types.ts";
import type { AgentRunner } from "../agent/agent-runner.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "../agent/events.ts";
import type { TaskInfra } from "./task-infra.ts";
import { PHASES, isGateAfter, isTerminalPhase, nextPhase } from "./phase-sequence.ts";

export interface StartTaskInput {
  title: string;
  description?: string;
  repoPath: string;
  kind: TaskKind;
}

export type GateDecision =
  | { kind: "approve" }
  | { kind: "rerun"; feedback?: string }
  | { kind: "stop" };

export interface TaskEngineDeps {
  store: Store;
  agent: AgentRunner;
  infra: TaskInfra;
  model: string;
  /** Clock for phase-run timestamps; defaults to real time. */
  now?: () => string;
}

type EventHandler = (event: AgentEvent) => void;
type OnEvent = (event: AgentEvent) => void;

export class TaskEngine {
  private store: Store;
  private agent: AgentRunner;
  private infra: TaskInfra;
  private model: string;
  private now: () => string;
  private subscribers = new Map<string, Set<EventHandler>>();

  constructor(deps: TaskEngineDeps) {
    this.store = deps.store;
    this.agent = deps.agent;
    this.infra = deps.infra;
    this.model = deps.model;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  getStatus(taskId: string): Task | null {
    return this.store.getTask(taskId);
  }

  /** All tasks, for the TUI/CLI list view. */
  listTasks(): Task[] {
    return this.store.queryTasks();
  }

  getEvents(taskId: string) {
    return this.store.getEvents(taskId);
  }

  subscribe(taskId: string, handler: EventHandler): () => void {
    let set = this.subscribers.get(taskId);
    if (!set) {
      set = new Set();
      this.subscribers.set(taskId, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  protected emit(taskId: string, event: AgentEvent): void {
    const set = this.subscribers.get(taskId);
    if (!set) return;
    for (const h of set) {
      try {
        h(event);
      } catch {
        // A buggy subscriber must not abort the phase or corrupt task state.
      }
    }
  }

  protected requireTask(taskId: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    return task;
  }

  async startTask(input: StartTaskInput, onEvent?: OnEvent): Promise<Task> {
    const task = this.store.createTask({
      title: input.title,
      description: input.description,
      kind: input.kind,
      repoPath: input.repoPath,
    });
    const off = onEvent ? this.subscribe(task.id, onEvent) : () => {};
    try {
      const result = await this.infra.provision(task.id, input.title);
      this.store.updateTask(task.id, {
        worktreePath: result.worktree.worktreePath,
        branch: result.worktree.branch,
        composeProject: result.composeStarted ? `grove-${task.id}` : null,
      });
      this.store.appendEvent({ taskId: task.id, type: "provisioned", payload: { branch: result.worktree.branch } });
      return await this.runFrom(task.id, "brainstorm");
    } finally {
      off();
    }
  }

  async confirmGate(taskId: string, decision: GateDecision, onEvent?: OnEvent): Promise<Task> {
    const task = this.requireTask(taskId);

    if (task.status === "done") {
      throw new Error(`cannot ${decision.kind} a completed task ${taskId}`);
    }

    if (decision.kind === "stop") {
      return this.store.updateTask(taskId, { status: "stopped" });
    }

    const off = onEvent ? this.subscribe(taskId, onEvent) : () => {};
    try {
      if (decision.kind === "rerun") {
        // Re-run the current phase ("request changes" with feedback, or "retry" without).
        return await this.runFrom(taskId, task.currentPhase, decision.feedback);
      }

      // approve
      if (task.status !== "waiting_confirm") {
        throw new Error(`cannot approve task ${taskId} in status ${task.status}`);
      }
      const next = nextPhase(task.currentPhase);
      if (!next) throw new Error(`no phase after ${task.currentPhase}`);
      return await this.runFrom(taskId, next);
    } finally {
      off();
    }
  }

  /** Resume a crashed-`running`, `blocked`, or `stopped` task by re-running its current phase forward. */
  async resume(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId);
    if (task.status === "waiting_confirm" || task.status === "done") return task;
    return this.runFrom(taskId, task.currentPhase);
  }

  /** Run phases from `start` forward, persisting, until a gate / terminal / failure. */
  protected async runFrom(
    taskId: string,
    start: Phase,
    feedback?: string,
  ): Promise<Task> {
    let phase: Phase | null = start;
    let firstPhase = true;
    while (phase) {
      const task = this.requireTask(taskId);
      this.store.updateTask(taskId, { status: "running", currentPhase: phase });
      const run = this.store.createPhaseRun({ taskId, phase, state: "running" });
      this.store.updatePhaseRun(run.id, { startedAt: this.now() });

      const ctx = this.buildContext(task, phase, firstPhase ? feedback : undefined);
      let result: PhaseResult;
      try {
        result = await this.runPhase(taskId, phase, ctx, run.id);
      } catch (err) {
        // A thrown agent error (vs a success:false return) must not escape and leave the
        // phase_run/task stuck in "running" — mark it failed + blocked, preserving the
        // persist-before-return invariant.
        this.store.updatePhaseRun(run.id, {
          state: "failed",
          summary: `phase ${phase} crashed: ${err instanceof Error ? err.message : String(err)}`,
          endedAt: this.now(),
        });
        this.store.updateTask(taskId, { status: "blocked", currentPhase: phase });
        return this.requireTask(taskId);
      }

      if (!result.success) {
        this.store.updateTask(taskId, { status: "blocked", currentPhase: phase });
        return this.requireTask(taskId);
      }

      if (isTerminalPhase(phase)) {
        const t = this.requireTask(taskId);
        // Mark done first — the work is integrated, so a teardown failure must not leave
        // the task stuck in "running". Teardown is best-effort cleanup; `grove gc` reclaims
        // anything left behind.
        this.store.updateTask(taskId, { status: "done", currentPhase: phase });
        if (t.worktreePath) {
          try {
            await this.infra.teardown(taskId, t.worktreePath);
          } catch {
            // best-effort
          }
        }
        return this.requireTask(taskId);
      }

      if (isGateAfter(phase)) {
        this.store.updateTask(taskId, { status: "waiting_confirm", currentPhase: phase });
        return this.requireTask(taskId);
      }

      phase = nextPhase(phase);
      firstPhase = false;
    }
    return this.requireTask(taskId);
  }

  private async runPhase(taskId: string, phase: Phase, ctx: PhaseContext, runId: string): Promise<PhaseResult> {
    const gen = this.agent.run(phase, ctx);
    let next = await gen.next();
    while (!next.done) {
      const event = next.value;
      this.store.appendEvent({ taskId, type: `agent:${event.type}`, payload: event });
      this.emit(taskId, event);
      next = await gen.next();
    }
    const result = next.value;
    this.store.updatePhaseRun(runId, {
      state: result.success ? "succeeded" : "failed",
      summary: result.summary,
      artifactPath: result.artifactPath,
      endedAt: this.now(),
    });
    return result;
  }

  private buildContext(task: Task, phase: Phase, feedback: string | undefined): PhaseContext {
    return {
      taskId: task.id,
      title: task.title,
      description: task.description ?? undefined,
      worktreePath: task.worktreePath ?? "",
      model: this.model,
      priorArtifacts: this.priorArtifacts(task.id, phase),
      feedback,
    };
  }

  /** Artifacts of earlier succeeded phases (reconstructed from the store, so resume works). */
  private priorArtifacts(taskId: string, phase: Phase): Array<{ phase: Phase; path: string }> {
    const idx = PHASES.indexOf(phase);
    // Keep only the latest succeeded run per phase — a rerun/resume creates extra
    // phase_run rows for the same phase. getPhaseRuns is rowid-ordered, so last write wins.
    const latest = new Map<Phase, string>();
    for (const r of this.store.getPhaseRuns(taskId)) {
      if (r.state === "succeeded" && r.artifactPath && PHASES.indexOf(r.phase) < idx) {
        latest.set(r.phase, r.artifactPath);
      }
    }
    const out: Array<{ phase: Phase; path: string }> = [];
    for (const p of PHASES) {
      const path = latest.get(p);
      if (path !== undefined) out.push({ phase: p, path });
    }
    return out;
  }
}
