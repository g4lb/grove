import { test, expect } from "bun:test";
import { join } from "node:path";

const SH = join(import.meta.dir, "..", "..", "install.sh");

async function dryRun(env: Record<string, string>) {
  const proc = Bun.spawn(["sh", SH, "--dry-run"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, out };
}

test("dry-run prints the planned asset + URL for the (overridden) platform", async () => {
  const { code, out } = await dryRun({ GROVE_FORCE_OS: "Linux", GROVE_FORCE_ARCH: "x86_64" });
  expect(code).toBe(0);
  expect(out).toContain("grove-linux-x64");
  expect(out).toContain("https://github.com/g4lb/grove/releases/latest/download/grove-linux-x64");
});

test("dry-run honors GROVE_VERSION for a tagged URL", async () => {
  const { out } = await dryRun({ GROVE_FORCE_OS: "Darwin", GROVE_FORCE_ARCH: "arm64", GROVE_VERSION: "v0.1.0" });
  expect(out).toContain("https://github.com/g4lb/grove/releases/download/v0.1.0/grove-darwin-arm64");
});

test("exits non-zero with a message on an unsupported platform", async () => {
  const { code, out } = await dryRun({ GROVE_FORCE_OS: "Windows_NT", GROVE_FORCE_ARCH: "x86_64" });
  expect(code).not.toBe(0);
  expect(out.toLowerCase()).toContain("unsupported");
});
