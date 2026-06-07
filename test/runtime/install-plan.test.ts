import { test, expect } from "bun:test";
import { planInstall } from "../../src/runtime/install-plan.ts";

test("maps uname to the release asset name", () => {
  expect(planInstall("Darwin", "arm64", "latest")!.asset).toBe("grove-darwin-arm64");
  expect(planInstall("Darwin", "x86_64", "latest")!.asset).toBe("grove-darwin-x64");
  expect(planInstall("Linux", "x86_64", "latest")!.asset).toBe("grove-linux-x64");
  expect(planInstall("Linux", "aarch64", "latest")!.asset).toBe("grove-linux-arm64");
});

test("builds latest vs versioned download URLs", () => {
  const latest = planInstall("Linux", "x86_64", "latest")!;
  expect(latest.binaryUrl).toBe("https://github.com/g4lb/grove/releases/latest/download/grove-linux-x64");
  expect(latest.checksumsUrl).toBe("https://github.com/g4lb/grove/releases/latest/download/SHASUMS256.txt");

  const tagged = planInstall("Linux", "x86_64", "v1.2.3")!;
  expect(tagged.binaryUrl).toBe("https://github.com/g4lb/grove/releases/download/v1.2.3/grove-linux-x64");
});

test("returns null for unsupported os/arch", () => {
  expect(planInstall("Windows_NT", "x86_64", "latest")).toBe(null);
  expect(planInstall("Linux", "ppc64", "latest")).toBe(null);
});
