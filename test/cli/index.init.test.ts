import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
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

test("grove init creates the grove home and prints a summary", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  try {
    const { code, stdout } = await runCli(["init"], { GROVE_HOME: root });
    expect([0, 1]).toContain(code);
    expect(stdout.toLowerCase()).toContain("grove");
    expect(existsSync(join(root, "grove.db"))).toBe(true);
    expect(existsSync(join(root, "config.json"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
