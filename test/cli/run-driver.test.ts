import { test, expect } from "bun:test";
import { runTask, type RunDeps, type RunEngine } from "../../src/cli/run-driver.ts";
import { HeuristicRouter } from "../../src/engine/router.ts";
import { resolvePaths } from "../../src/config/paths.ts";
import type { Task } from "../../src/domain/types.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "waiting_confirm",
    currentPhase: "brainstorm",
    repoPath: "/repo",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

function fakeEngine(states: Task[]): RunEngine {
  let i = 0;
  return {
    async startTask() {
      return states[i++]!;
    },
    async confirmGate(_id, _d: GateDecision) {
      return states[i++]!;
    },
    subscribe() {
      return () => {};
    },
  };
}

function deps(over: Partial<RunDeps>): RunDeps {
  return {
    engine: fakeEngine([task({ status: "done", currentPhase: "finish" })]),
    router: new HeuristicRouter(),
    disk: { async freeBytes() { return 100 * 1024 ** 3; }, evaluate() { return "ok"; } },
    thresholds: { warnBytes: 10, blockBytes: 2 },
    paths: resolvePaths("/groveroot"),
    repoPath: "/repo",
    hasCredential: true,
    isGitRepo: true,
    yes: true,
    decide: async () => ({ kind: "approve" }),
    out: () => {},
    ...over,
  };
}

test("fails fast with no credential (never provisions)", async () => {
  let started = false;
  const e: RunEngine = { async startTask() { started = true; return task({}); }, async confirmGate() { return task({}); }, subscribe() { return () => {}; } };
  const res = await runTask("add a page", deps({ hasCredential: false, engine: e }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("credential");
  expect(started).toBe(false);
});

test("fails fast when cwd is not a git repo", async () => {
  const res = await runTask("add a page", deps({ isGitRepo: false }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("git");
});

test("blocks when disk is below the block threshold", async () => {
  const res = await runTask("add a page", deps({ disk: { async freeBytes() { return 1; }, evaluate() { return "block"; } } }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("disk");
});

test("with --yes, drives the task to done", async () => {
  const res = await runTask("add a settings page", deps({
    engine: fakeEngine([
      task({ status: "waiting_confirm", currentPhase: "brainstorm" }),
      task({ status: "waiting_confirm", currentPhase: "plan" }),
      task({ status: "waiting_confirm", currentPhase: "review" }),
      task({ status: "done", currentPhase: "finish" }),
    ]),
    yes: true,
  }));
  expect(res.ok).toBe(true);
  expect(res.status).toBe("done");
});

test("uses the injected decider when not --yes (and stop ends the run)", async () => {
  const res = await runTask("add a page", deps({
    engine: fakeEngine([
      task({ status: "waiting_confirm", currentPhase: "brainstorm" }),
      task({ status: "stopped", currentPhase: "brainstorm" }),
    ]),
    yes: false,
    decide: async () => ({ kind: "stop" }),
  }));
  expect(res.status).toBe("stopped");
});

test("a debug-classified request is noted and still runs (v1.1 note)", async () => {
  const out: string[] = [];
  await runTask("fix the broken login", deps({
    engine: fakeEngine([task({ status: "done", currentPhase: "finish", kind: "issue" })]),
    out: (l) => out.push(l),
  }));
  expect(out.join("\n").toLowerCase()).toContain("debug");
  expect(out.join("\n").toLowerCase()).toContain("v1.1");
});
