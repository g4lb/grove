import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { buildEngine, startInput, ok, fail, FakeTaskInfra } from "./helpers.ts";
import type { AgentRunner } from "../../src/agent/agent-runner.ts";
import type { AgentEvent, SessionContext, SessionResult } from "../../src/agent/events.ts";

// An AgentRunner whose run() throws mid-session (e.g. network drop / auth failure).
class ThrowingRunner implements AgentRunner {
  // eslint-disable-next-line require-yield
  async *run(_ctx: SessionContext): AsyncGenerator<AgentEvent, SessionResult> {
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
  const task = await engine.startTask(startInput());
  expect(task.status).toBe("blocked");
  expect(task.currentPhase).toBe("session");

  const runs = store.getPhaseRuns(task.id);
  expect(runs.length).toBe(1);
  expect(runs[0]!.state).toBe("failed");
  expect(runs[0]!.summary).toContain("network drop");
});

test("phase runs record startedAt", async () => {
  const { engine, store } = buildEngine(ok());
  const t = await engine.startTask(startInput());
  const runs = store.getPhaseRuns(t.id);
  expect(runs[0]!.startedAt).toBe("2026-06-06T00:00:00.000Z");
});

test("a throwing subscriber does not corrupt the task — the session still completes its run", async () => {
  const { engine } = buildEngine(fail("nope", [{ type: "token", text: "hi" }]));
  let threw = false;
  // The onEvent subscriber throws on every event; emit must isolate it so the run still completes.
  const t = await engine.startTask(startInput(), () => {
    threw = true;
    throw new Error("bad subscriber");
  });
  expect(threw).toBe(true);
  expect(t.status).toBe("blocked"); // run completed; not left stuck in "running"
});

test("a failing teardown still completes the task to done (does not propagate, no stuck-running)", async () => {
  class ThrowingTeardownInfra extends FakeTaskInfra {
    async teardown(): Promise<void> {
      throw new Error("docker down failed");
    }
  }
  const { engine } = buildEngine(ok(), { infra: new ThrowingTeardownInfra() });
  const done = await engine.startTask(startInput());
  expect(done.status).toBe("done");
});

test("a provision failure leaves the task blocked, not stuck running (and never throws)", async () => {
  class ThrowingProvisionInfra extends FakeTaskInfra {
    async provision(): Promise<never> {
      throw new Error("git worktree add failed");
    }
  }
  const { engine } = buildEngine(ok(), { infra: new ThrowingProvisionInfra() });
  const t = await engine.startTask(startInput()); // must resolve, not reject
  expect(t.status).toBe("blocked"); // not the default "running"
});

test("a git error verifying commits does not escape — the task is blocked (not stuck running)", async () => {
  class ThrowingCommitCheckInfra extends FakeTaskInfra {
    async committedChanges(): Promise<boolean> {
      throw new Error("git rev-list failed");
    }
  }
  const { engine, store } = buildEngine(ok(), { infra: new ThrowingCommitCheckInfra() });
  const t = await engine.startTask(startInput());
  expect(t.status).toBe("blocked"); // not "running", not "done"
  expect((store.getPhaseRuns(t.id)[0]!.summary ?? "").toLowerCase()).toContain("could not be verified");
});
