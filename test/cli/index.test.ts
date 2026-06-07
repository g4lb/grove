import { test, expect } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

test("--version prints the version and exits 0", async () => {
  const { code, stdout } = await runCli(["--version"]);
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("0.1.2");
});

test("doctor runs and exits (0 or 1) with per-dependency lines", async () => {
  const { code, stdout } = await runCli(["doctor"]);
  expect([0, 1]).toContain(code);
  expect(stdout).toContain("git");
  expect(stdout).toContain("docker");
});

test("an unknown command prints usage", async () => {
  const { code, stdout } = await runCli(["bogus-command"]);
  expect(code).toBe(0);
  expect(stdout.toLowerCase()).toContain("usage");
});
