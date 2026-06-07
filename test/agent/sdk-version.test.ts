import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { CLAUDE_SDK_VERSION } from "../../src/agent/sdk-version.ts";

test("CLAUDE_SDK_VERSION is a non-empty semver", () => {
  expect(CLAUDE_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test("CLAUDE_SDK_VERSION matches the installed Agent SDK (guards drift)", () => {
  const installed = JSON.parse(
    readFileSync("node_modules/@anthropic-ai/claude-agent-sdk/package.json", "utf8"),
  ).version as string;
  expect(CLAUDE_SDK_VERSION).toBe(installed);
});
