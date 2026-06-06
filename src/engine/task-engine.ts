import type { Store } from "../store/store.ts";
import type { Task, TaskKind, Phase } from "../domain/types.ts";
import type { AgentRunner } from "../agent/agent-runner.ts";
import type { AgentEvent } from "../agent/events.ts";
import type { TaskInfra } from "./task-infra.ts";

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
    if (set) for (const h of set) h(event);
  }

  protected requireTask(taskId: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    return task;
  }
}
