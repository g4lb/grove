import { test, expect } from "bun:test";
import { detectPlatform, platformPackage, tarballUrl } from "../../src/runtime/fetch-claude.ts";

test("detectPlatform maps supported os/arch", () => {
  expect(detectPlatform("darwin", "arm64")).toEqual({ os: "darwin", arch: "arm64" });
  expect(detectPlatform("darwin", "x64")).toEqual({ os: "darwin", arch: "x64" });
  expect(detectPlatform("linux", "x64")).toEqual({ os: "linux", arch: "x64" });
  expect(detectPlatform("linux", "arm64")).toEqual({ os: "linux", arch: "arm64" });
  expect(detectPlatform("linux", "x86_64")).toEqual({ os: "linux", arch: "x64" });
});

test("detectPlatform returns null for unsupported platforms", () => {
  expect(detectPlatform("win32", "x64")).toBe(null);
  expect(detectPlatform("linux", "ppc64")).toBe(null);
});

test("platformPackage builds the scoped package name", () => {
  expect(platformPackage({ os: "darwin", arch: "arm64" })).toBe("@anthropic-ai/claude-agent-sdk-darwin-arm64");
  expect(platformPackage({ os: "linux", arch: "x64" })).toBe("@anthropic-ai/claude-agent-sdk-linux-x64");
});

test("tarballUrl builds the npm registry tarball URL", () => {
  expect(tarballUrl("@anthropic-ai/claude-agent-sdk-darwin-arm64", "0.3.167")).toBe(
    "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.167.tgz",
  );
});
