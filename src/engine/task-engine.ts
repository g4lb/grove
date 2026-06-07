import type { Store } from "../store/store.ts";
import type { Task, TaskKind } from "../domain/types.ts";
import type { AgentRunner } from "../agent/agent-runner.ts";
import type { AgentEvent, SessionContext, SessionResult } from "../agent/events.ts";
import type { TaskInfra } from "./task-infra.ts";

export interface StartTaskInput {
  title: string;
  description?: string;
  repoPath: string;
  kind: TaskKind;
  /** Absolute path to the resolved superpowers plugin directory. */
  superpowersPath: string;
}

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
        // A buggy subscriber must not abort the session or corrupt task state.
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
      return await this.runSession(task.id, input.superpowersPath, input.description ?? input.title, result.worktree.baseSha);
    } finally {
      off();
    }
  }

  /**
   * Run one autonomous agent session, persisting before returning.
   *
   * `baseSha` is the repo SHA the worktree branched from at provision time: a "successful"
   * session is only reported `done` if it actually committed work onto the branch (the SDK
   * reports success when the conversation ends normally, even with an empty branch).
   */
  protected async runSession(
    taskId: string,
    superpowersPath: string,
    prose: string,
    baseSha: string,
  ): Promise<Task> {
    const task = this.requireTask(taskId);
    this.store.updateTask(taskId, { status: "running", currentPhase: "session" });
    const run = this.store.createPhaseRun({ taskId, phase: "session", state: "running" });
    this.store.updatePhaseRun(run.id, { startedAt: this.now() });

    const ctx: SessionContext = {
      taskId: task.id,
      title: task.title,
      prose,
      worktreePath: task.worktreePath ?? "",
      branch: task.branch ?? "",
      model: this.model,
      superpowersPath,
    };

    let result: SessionResult;
    try {
      result = await this.runAgent(taskId, ctx);
    } catch (err) {
      // A thrown agent error (vs a success:false return) must not escape and leave the
      // phase_run/task stuck in "running" — mark it failed + blocked, preserving the
      // persist-before-return invariant.
      this.store.updatePhaseRun(run.id, {
        state: "failed",
        summary: `session crashed: ${err instanceof Error ? err.message : String(err)}`,
        endedAt: this.now(),
      });
      this.store.updateTask(taskId, { status: "blocked", currentPhase: "session" });
      return this.requireTask(taskId);
    }

    this.store.updatePhaseRun(run.id, {
      state: result.success ? "succeeded" : "failed",
      summary: result.summary,
      endedAt: this.now(),
    });

    if (!result.success) {
      this.store.updateTask(taskId, { status: "blocked", currentPhase: "session" });
      return this.requireTask(taskId);
    }

    // The SDK reports success when the conversation ends normally — even if the agent
    // committed nothing. Reporting "done — branch ready" then would mislead. Gate `done` on
    // the worktree branch having commits ahead of the base it branched from; otherwise leave
    // the worktree in place (no teardown) for inspection and mark the task blocked.
    const gated = this.requireTask(taskId);
    if (gated.worktreePath) {
      let committed = false;
      let summary = "session finished but committed no changes";
      try {
        committed = await this.infra.committedChanges(gated.worktreePath, baseSha);
      } catch (err) {
        // A git failure verifying commits must NOT escape and leave the task stuck "running"
        // (the persist-before-return invariant). Treat an unverifiable result as not-done.
        summary = `session finished but its result could not be verified: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!committed) {
        this.store.updatePhaseRun(run.id, { state: "failed", summary, endedAt: this.now() });
        this.store.updateTask(taskId, { status: "blocked", currentPhase: "session" });
        return this.requireTask(taskId);
      }
    }

    // Mark done first — the work is committed on the branch, so a teardown failure must
    // not leave the task stuck in "running". Teardown is best-effort; `grove gc` reclaims
    // anything left behind.
    const t = this.requireTask(taskId);
    this.store.updateTask(taskId, { status: "done", currentPhase: "session" });
    if (t.worktreePath) {
      try {
        await this.infra.teardown(taskId, t.worktreePath);
      } catch {
        // best-effort
      }
    }
    return this.requireTask(taskId);
  }

  private async runAgent(taskId: string, ctx: SessionContext): Promise<SessionResult> {
    const gen = this.agent.run(ctx);
    let next = await gen.next();
    while (!next.done) {
      const event = next.value;
      this.store.appendEvent({ taskId, type: `agent:${event.type}`, payload: event });
      this.emit(taskId, event);
      next = await gen.next();
    }
    return next.value;
  }
}
