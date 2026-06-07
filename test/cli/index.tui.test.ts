import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

test("grove with no args and no credential fails fast (does not launch the TUI)", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  try {
    const { code, stdout } = await runCli([], {
      GROVE_HOME: root,
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      // This dev machine is logged into Claude Code; force "no credential" deterministically.
      GROVE_DISABLE_CLAUDE_LOGIN_DETECTION: "1",
    });
    expect(code).toBe(1);
    expect(stdout.toLowerCase()).toContain("credential");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grove (TUI) outside a git repo fails fast with a clear message (not a raw git error)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grove-nogit-"));
  try {
    const proc = Bun.spawn(["bun", ENTRY], {
      cwd: dir, // a fresh temp dir, not a git repo
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, GROVE_HOME: join(dir, ".grove") },
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(1);
    expect(stdout.toLowerCase()).toContain("git repository");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
