import { test, expect } from "bun:test";
import { runTask, type RunDeps, type RunEngine } from "../../src/cli/run-driver.ts";
import { resolvePaths } from "../../src/config/paths.ts";
import type { Task } from "../../src/domain/types.ts";
import type { AgentEvent } from "../../src/agent/events.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "done",
    currentPhase: "session",
    repoPath: "/repo",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

function fakeEngine(result: Task, capture?: { input?: unknown; events?: AgentEvent[] }): RunEngine {
  return {
    async startTask(input, onEvent) {
      if (capture) capture.input = input;
      if (onEvent && capture?.events) for (const e of capture.events) onEvent(e);
      return result;
    },
  };
}

function deps(over: Partial<RunDeps>): RunDeps {
  return {
    engine: fakeEngine(task({ status: "done" })),
    disk: { async freeBytes() { return 100 * 1024 ** 3; }, evaluate() { return "ok"; } },
    thresholds: { warnBytes: 10, blockBytes: 2 },
    paths: resolvePaths("/groveroot"),
    repoPath: "/repo",
    hasCredential: true,
    hasClaudeRuntime: true,
    isGitRepo: true,
    superpowersPath: "/sp",
    out: () => {},
    ...over,
  };
}

test("fails fast with no credential (never provisions)", async () => {
  let started = false;
  const e: RunEngine = { async startTask() { started = true; return task({}); } };
  const res = await runTask("add a page", deps({ hasCredential: false, engine: e }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("credential");
  expect(started).toBe(false);
});

test("fails fast when the claude runtime is missing", async () => {
  let started = false;
  const e: RunEngine = { async startTask() { started = true; return task({}); } };
  const res = await runTask("add a page", deps({ hasClaudeRuntime: false, engine: e }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("install-runtime");
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

test("runs one session and reports done with the branch", async () => {
  const res = await runTask("add a settings page", deps({
    engine: fakeEngine(task({ status: "done", branch: "grove/task_1" })),
  }));
  expect(res.ok).toBe(true);
  expect(res.status).toBe("done");
  expect(res.message).toContain("grove/task_1");
});

test("a blocked session reports not-ok", async () => {
  const res = await runTask("add a page", deps({
    engine: fakeEngine(task({ status: "blocked" })),
  }));
  expect(res.ok).toBe(false);
  expect(res.status).toBe("blocked");
});

test("passes the prose and superpowers path into the engine and streams events out", async () => {
  const capture: { input?: any; events?: AgentEvent[] } = {
    events: [{ type: "tool_use", tool: "Write", input: {} }, { type: "notice", message: "session started" }],
  };
  const out: string[] = [];
  await runTask("add a page", deps({
    engine: fakeEngine(task({ status: "done" }), capture),
    superpowersPath: "/my/sp",
    out: (l) => out.push(l),
  }));
  expect(capture.input.superpowersPath).toBe("/my/sp");
  expect(capture.input.description).toBe("add a page");
  expect(capture.input.title).toBe("add a page");
  expect(out.join("\n")).toContain("Write");
  expect(out.join("\n")).toContain("session started");
});
