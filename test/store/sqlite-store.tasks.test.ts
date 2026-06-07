import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";

function makeStore(now: () => string = () => "2026-06-06T00:00:00.000Z") {
  return SqliteStore.open(":memory:", { now });
}

test("createTask applies defaults and round-trips", () => {
  const store = makeStore();
  const task = store.createTask({ title: "add login", kind: "task", repoPath: "/repo" });
  expect(task.id.startsWith("task_")).toBe(true);
  expect(task.title).toBe("add login");
  expect(task.kind).toBe("task");
  expect(task.status).toBe("running");
  expect(task.currentPhase).toBe("session");
  expect(task.repoPath).toBe("/repo");
  expect(task.worktreePath).toBeNull();
  expect(task.createdAt).toBe("2026-06-06T00:00:00.000Z");
  expect(store.getTask(task.id)).toEqual(task);
  store.close();
});

test("getTask returns null for unknown id", () => {
  const store = makeStore();
  expect(store.getTask("task_nope")).toBeNull();
  store.close();
});

test("updateTask applies a patch and bumps updatedAt", () => {
  let t = 0;
  const store = makeStore(() => `2026-06-06T00:00:0${t++}.000Z`);
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/repo" });
  const updated = store.updateTask(task.id, {
    status: "waiting_confirm",
    worktreePath: "/repo/.grove/wt",
    branch: "grove/abc",
  });
  expect(updated.status).toBe("waiting_confirm");
  expect(updated.worktreePath).toBe("/repo/.grove/wt");
  expect(updated.branch).toBe("grove/abc");
  expect(updated.updatedAt).not.toBe(task.updatedAt);
  expect(store.getTask(task.id)?.status).toBe("waiting_confirm");
  store.close();
});

test("updateTask throws for unknown id", () => {
  const store = makeStore();
  expect(() => store.updateTask("task_nope", { status: "done" })).toThrow();
  store.close();
});

test("queryTasks returns all, newest first, and filters by status", () => {
  let t = 0;
  const store = makeStore(() => `2026-06-06T00:00:0${t++}.000Z`);
  const a = store.createTask({ title: "a", kind: "task", repoPath: "/r" });
  const b = store.createTask({ title: "b", kind: "task", repoPath: "/r" });
  store.updateTask(a.id, { status: "done" });
  const all = store.queryTasks();
  expect(all.length).toBe(2);
  const done = store.queryTasks({ status: "done" });
  expect(done.length).toBe(1);
  expect(done[0]!.id).toBe(a.id);
  store.close();
});
