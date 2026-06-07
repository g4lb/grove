import { test, expect } from "bun:test";
import { buildEngine, startInput, ok } from "./helpers.ts";
import type { AgentEvent } from "../../src/agent/events.ts";

test("startTask delivers session events to onEvent", async () => {
  const { engine } = buildEngine(
    ok("done", [
      { type: "notice", message: "session started" },
      { type: "tool_use", tool: "Write", input: {} },
    ]),
  );
  const seen: AgentEvent[] = [];
  await engine.startTask(startInput(), (e) => seen.push(e));
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: {} });
});

test("onEvent is unsubscribed after the call (no leak to a later run)", async () => {
  const { engine } = buildEngine(ok("done", [{ type: "notice", message: "a" }]));
  const seen: AgentEvent[] = [];
  await engine.startTask(startInput(), (e) => seen.push(e));
  const before = seen.length;
  // a second start (no onEvent) must not feed the first subscriber
  await engine.startTask(startInput());
  expect(seen.length).toBe(before);
});
