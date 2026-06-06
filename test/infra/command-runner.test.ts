import { test, expect } from "bun:test";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";

test("BunCommandRunner runs a real command and captures stdout + exit code", async () => {
  const runner = new BunCommandRunner();
  const res = await runner.run("echo", ["hello"]);
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe("hello");
});

test("BunCommandRunner returns code 127 when the command is missing", async () => {
  const runner = new BunCommandRunner();
  const res = await runner.run("definitely-not-a-real-binary-xyz", []);
  expect(res.code).toBe(127);
});
