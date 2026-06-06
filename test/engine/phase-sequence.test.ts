import { test, expect } from "bun:test";
import { PHASES, isGateAfter, nextPhase, isTerminalPhase } from "../../src/engine/phase-sequence.ts";

test("PHASES is the full ordered sequence", () => {
  expect(PHASES).toEqual(["brainstorm", "plan", "execute", "review", "finish"]);
});

test("gates are after brainstorm, plan, and review only", () => {
  expect(isGateAfter("brainstorm")).toBe(true);
  expect(isGateAfter("plan")).toBe(true);
  expect(isGateAfter("review")).toBe(true);
  expect(isGateAfter("execute")).toBe(false);
  expect(isGateAfter("finish")).toBe(false);
});

test("nextPhase walks the sequence and returns null after finish", () => {
  expect(nextPhase("brainstorm")).toBe("plan");
  expect(nextPhase("plan")).toBe("execute");
  expect(nextPhase("execute")).toBe("review");
  expect(nextPhase("review")).toBe("finish");
  expect(nextPhase("finish")).toBeNull();
});

test("isTerminalPhase is true only for finish", () => {
  expect(isTerminalPhase("finish")).toBe(true);
  expect(isTerminalPhase("review")).toBe(false);
});
