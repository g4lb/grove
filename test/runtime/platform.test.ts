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

import { detectLibc } from "../../src/runtime/fetch-claude.ts";

test("detectPlatform tags musl only when explicitly musl on linux", () => {
  expect(detectPlatform("linux", "x64", "musl")).toEqual({ os: "linux", arch: "x64", libc: "musl" });
  expect(detectPlatform("linux", "arm64", "musl")).toEqual({ os: "linux", arch: "arm64", libc: "musl" });
  // glibc / unspecified → no libc field (keeps the package name suffix-free)
  expect(detectPlatform("linux", "x64", "glibc")).toEqual({ os: "linux", arch: "x64" });
  expect(detectPlatform("darwin", "arm64", "musl")).toEqual({ os: "darwin", arch: "arm64" }); // libc irrelevant on darwin
});

test("platformPackage appends -musl only for musl linux", () => {
  expect(platformPackage({ os: "linux", arch: "x64", libc: "musl" })).toBe("@anthropic-ai/claude-agent-sdk-linux-x64-musl");
  expect(platformPackage({ os: "linux", arch: "arm64", libc: "musl" })).toBe("@anthropic-ai/claude-agent-sdk-linux-arm64-musl");
  expect(platformPackage({ os: "linux", arch: "x64" })).toBe("@anthropic-ai/claude-agent-sdk-linux-x64");
});

test("detectLibc checks for the musl loader via an injectable fs probe", () => {
  expect(detectLibc((p) => p.includes("ld-musl"))).toBe("musl");
  expect(detectLibc(() => false)).toBe("glibc");
});
