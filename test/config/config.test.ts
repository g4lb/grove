import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/config/paths.ts";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../../src/config/config.ts";

function tempPaths() {
  return resolvePaths(mkdtempSync(join(tmpdir(), "grove-")));
}

test("loadConfig returns defaults when no file exists", async () => {
  const paths = tempPaths();
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(DEFAULT_CONFIG.disk.warnBytes);
  expect(cfg.disk.blockBytes).toBe(DEFAULT_CONFIG.disk.blockBytes);
});

test("saveConfig then loadConfig round-trips overrides", async () => {
  const paths = tempPaths();
  await saveConfig(paths, { disk: { warnBytes: 5, blockBytes: 1 }, agent: { model: "claude-opus-4-8" } });
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(5);
  expect(cfg.disk.blockBytes).toBe(1);
});

test("loadConfig merges partial file over defaults", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, JSON.stringify({ disk: { warnBytes: 7 } }));
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(7);
  expect(cfg.disk.blockBytes).toBe(DEFAULT_CONFIG.disk.blockBytes);
});

test("loadConfig falls back to defaults on malformed JSON", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, "{ not valid json ");
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(DEFAULT_CONFIG.disk.warnBytes);
  expect(cfg.disk.blockBytes).toBe(DEFAULT_CONFIG.disk.blockBytes);
});

test("loadConfig returns a fresh object that does not alias DEFAULT_CONFIG", async () => {
  const paths = tempPaths();
  const cfg = await loadConfig(paths);
  expect(cfg).not.toBe(DEFAULT_CONFIG);
  expect(cfg.disk).not.toBe(DEFAULT_CONFIG.disk);
  // mutating the result must not corrupt the shared default
  cfg.disk.warnBytes = 123;
  expect(DEFAULT_CONFIG.disk.warnBytes).toBe(10 * 1024 ** 3);
});
