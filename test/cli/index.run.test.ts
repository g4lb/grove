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

test("grove run with no Anthropic credential fails fast with a clear message", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  mkdirSync(join(root, "tasks"), { recursive: true });
  try {
    const { code, stdout } = await runCli(["run", "add a page"], {
      GROVE_HOME: root,
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
    });
    expect(code).toBe(1);
    expect(stdout.toLowerCase()).toContain("credential");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grove run with no prose prints usage", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  try {
    const { code, stdout } = await runCli(["run"], { GROVE_HOME: root, ANTHROPIC_API_KEY: "" });
    expect([0, 1]).toContain(code);
    expect(stdout.toLowerCase()).toContain("usage");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
