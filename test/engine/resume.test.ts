import { test, expect } from "bun:test";
import { buildEngine, startInput, ok, fail, SUPERPOWERS_PATH } from "./helpers.ts";

test("resume on a blocked task re-runs the session", async () => {
  const { engine, store } = buildEngine(fail("nope"));
  const t0 = await engine.startTask(startInput());
  expect(store.getTask(t0.id)!.status).toBe("blocked");

  const resumed = await engine.resume(t0.id, { superpowersPath: SUPERPOWERS_PATH });
  // still scripted to fail -> blocked again, but the session was attempted again
  expect(resumed.status).toBe("blocked");
});

test("resume on a done task is a no-op", async () => {
  const { engine } = buildEngine(ok());
  const t0 = await engine.startTask(startInput());
  expect(t0.status).toBe("done");
  const resumed = await engine.resume(t0.id, { superpowersPath: SUPERPOWERS_PATH });
  expect(resumed.status).toBe("done");
});

test("resume passes the superpowers path and the persisted description into the session", async () => {
  const { engine, agent } = buildEngine(fail("nope"));
  const t0 = await engine.startTask(startInput({ description: "do the thing" }));
  await engine.resume(t0.id, { superpowersPath: SUPERPOWERS_PATH });
  expect(agent.contexts.length).toBe(2);
  expect(agent.contexts[1]!.superpowersPath).toBe(SUPERPOWERS_PATH);
  expect(agent.contexts[1]!.prose).toBe("do the thing");
});
