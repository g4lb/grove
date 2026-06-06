import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";

function makeStore() {
  return SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
}

test("appendEvent stores JSON payload and returns the event", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  const evt = store.appendEvent({ taskId: task.id, type: "phase_started", payload: { phase: "brainstorm" } });
  expect(evt.id.startsWith("evt_")).toBe(true);
  expect(evt.taskId).toBe(task.id);
  expect(evt.type).toBe("phase_started");
  expect(JSON.parse(evt.payload)).toEqual({ phase: "brainstorm" });
  store.close();
});

test("getEvents returns events for a task in append order", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  store.appendEvent({ taskId: task.id, type: "a", payload: 1 });
  store.appendEvent({ taskId: task.id, type: "b", payload: 2 });
  const events = store.getEvents(task.id);
  expect(events.length).toBe(2);
  expect(events[0]!.type).toBe("a");
  expect(events[1]!.type).toBe("b");
  store.close();
});
