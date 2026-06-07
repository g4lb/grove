import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORMULA = readFileSync(join(import.meta.dir, "..", "..", "packaging", "homebrew", "grove.rb"), "utf8");

test("formula declares the class, homepage, and per-arch macOS + Linux assets", () => {
  expect(FORMULA).toContain("class Grove < Formula");
  expect(FORMULA).toMatch(/on_macos/);
  expect(FORMULA).toMatch(/on_linux/);
  expect(FORMULA).toContain("grove-darwin-arm64");
  expect(FORMULA).toContain("grove-darwin-x64");
  expect(FORMULA).toContain("grove-linux-x64");
  expect(FORMULA).toContain("grove-linux-arm64");
});

test("formula installs the binary as `grove` and tells the user to run install-runtime", () => {
  expect(FORMULA).toMatch(/bin\.install.*=> "grove"/);
  expect(FORMULA.toLowerCase()).toContain("install-runtime");
});
