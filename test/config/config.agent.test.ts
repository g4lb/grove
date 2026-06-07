import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/config/paths.ts";
import { loadConfig, DEFAULT_CONFIG } from "../../src/config/config.ts";

function tempPaths() {
  return resolvePaths(mkdtempSync(join(tmpdir(), "grove-")));
}

test("default agent.model is claude-opus-4-8", () => {
  expect(DEFAULT_CONFIG.agent.model).toBe("claude-opus-4-8");
});

test("loadConfig returns the default agent.model when no file exists", async () => {
  const cfg = await loadConfig(tempPaths());
  expect(cfg.agent.model).toBe("claude-opus-4-8");
});

test("a partial config file overriding agent.model is merged over defaults", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, JSON.stringify({ agent: { model: "claude-sonnet-4-6" } }));
  const cfg = await loadConfig(paths);
  expect(cfg.agent.model).toBe("claude-sonnet-4-6");
  expect(cfg.disk.warnBytes).toBe(DEFAULT_CONFIG.disk.warnBytes);
});

test("a config file overriding only disk keeps the default agent.model", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, JSON.stringify({ disk: { warnBytes: 5 } }));
  const cfg = await loadConfig(paths);
  expect(cfg.agent.model).toBe("claude-opus-4-8");
  expect(cfg.disk.warnBytes).toBe(5);
});
