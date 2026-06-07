import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

test("grove gc --yes runs and reports (no orphans on a fresh home)", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  mkdirSync(join(root, "tasks"), { recursive: true });
  try {
    const { code, stdout } = await runCli(["gc", "--yes"], { GROVE_HOME: root });
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("gc");
    expect(stdout.toLowerCase()).toMatch(/nothing to reclaim|reclaimed 0|no orphans/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000); // spawns `grove gc` → bun cold-start + docker discovery; generous timeout for cold CI runners

test("grove gc works against a never-initialized GROVE_HOME (creates the home)", async () => {
  // A GROVE_HOME that does not exist at all — gc must create it (mkdir + db)
  // before opening the store, so it works without a prior `grove init`.
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), "never-init", ".grove");
  try {
    const { code, stdout } = await runCli(["gc"], { GROVE_HOME: root });
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/nothing to reclaim|reclaimed 0|no orphans/);
  } finally {
    rmSync(join(root, "..", ".."), { recursive: true, force: true });
  }
}, 30000); // spawns `grove gc` → bun cold-start + docker discovery; generous timeout for cold CI runners
