import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { buildEngine, ok, FakeTaskInfra } from "./helpers.ts";
import type { AgentRunner } from "../../src/agent/agent-runner.ts";
import type { Phase } from "../../src/domain/types.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "../../src/agent/events.ts";

// An AgentRunner whose run() throws mid-phase (e.g. network drop / auth failure).
class ThrowingRunner implements AgentRunner {
  // eslint-disable-next-line require-yield
  async *run(_phase: Phase, _ctx: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult> {
    throw new Error("network drop");
  }
}

test("a thrown agent error moves the task to blocked (does not propagate) and marks the phase_run failed", async () => {
  const store = SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
  const engine = new TaskEngine({
    store,
    agent: new ThrowingRunner(),
    infra: new FakeTaskInfra(),
    model: "m",
    now: () => "2026-06-06T00:00:00.000Z",
  });

  // startTask must NOT throw — it should resolve with a blocked task.
  const task = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  expect(task.status).toBe("blocked");
  expect(task.currentPhase).toBe("brainstorm");

  const runs = store.getPhaseRuns(task.id);
  expect(runs.length).toBe(1);
  expect(runs[0]!.state).toBe("failed");
  expect(runs[0]!.summary).toContain("network drop");
});

test("phase runs record startedAt", async () => {
  const { engine, store } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  const t = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const runs = store.getPhaseRuns(t.id);
  expect(runs[0]!.startedAt).toBe("2026-06-06T00:00:00.000Z");
});

test("a throwing subscriber does not block the task — the phase still completes normally", async () => {
  const { engine } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md", [{ type: "token", text: "hi" }]) });
  // register a subscriber that throws on every event
  let taskId = "";
  // we need the id before events fire; subscribe to all by registering on the id after createTask is internal.
  // Instead, subscribe broadly: the engine emits per-taskId, so subscribe using a side channel —
  // simplest: start the task, which emits during the awaited call, but we can't subscribe before the id exists.
  // So assert the inverse: a subscriber added for a known id that throws is isolated. Use a 2-step flow:
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" }); // brainstorm gate
  taskId = t0.id;
  let threw = false;
  engine.subscribe(taskId, () => { threw = true; throw new Error("bad subscriber"); });
  // rerun emits events again; a throwing subscriber must NOT block the task
  const t1 = await engine.confirmGate(taskId, { kind: "rerun" });
  expect(threw).toBe(true);
  expect(t1.status).toBe("waiting_confirm"); // not blocked
  expect(t1.currentPhase).toBe("brainstorm");
});
