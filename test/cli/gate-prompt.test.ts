import { test, expect } from "bun:test";
import { stdinGateDecider } from "../../src/cli/gate-prompt.ts";

/** A scripted readLine that returns queued answers in order. */
function scripted(answers: string[]) {
  let i = 0;
  return async (_prompt: string) => answers[i++] ?? "";
}

test("'a' approves", async () => {
  expect(await stdinGateDecider(scripted(["a"]))).toEqual({ kind: "approve" });
});

test("'s' stops", async () => {
  expect(await stdinGateDecider(scripted(["s"]))).toEqual({ kind: "stop" });
});

test("'r' then feedback re-runs with that feedback", async () => {
  expect(await stdinGateDecider(scripted(["r", "use OAuth, not passwords"]))).toEqual({
    kind: "rerun",
    feedback: "use OAuth, not passwords",
  });
});

test("answers are case-insensitive and trimmed", async () => {
  expect(await stdinGateDecider(scripted(["  A  "]))).toEqual({ kind: "approve" });
});

test("an empty/unknown answer defaults to stop (safe)", async () => {
  expect(await stdinGateDecider(scripted([""]))).toEqual({ kind: "stop" });
});
