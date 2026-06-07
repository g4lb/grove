import { test, expect } from "bun:test";
import { TARGETS, buildAll, type BuildAllDeps } from "../../scripts/build-all.ts";

test("TARGETS covers macOS + Linux on arm64 + x64", () => {
  expect(TARGETS.map((t) => t.outfile).sort()).toEqual([
    "grove-darwin-arm64",
    "grove-darwin-x64",
    "grove-linux-arm64",
    "grove-linux-x64",
  ]);
  for (const t of TARGETS) expect(t.target).toMatch(/^bun-(darwin|linux)-(arm64|x64)$/);
});

test("buildAll builds every target and writes a SHASUMS file with one line per binary", async () => {
  const builds: Array<{ target: string; out: string }> = [];
  let checksums = "";
  let checksumPath = "";
  const deps: BuildAllDeps = {
    outDir: "/dist",
    build: async (target, out) => { builds.push({ target, out }); },
    sha256: async (file) => `sha_${file.split("/").pop()}`,
    writeChecksums: (path, content) => { checksumPath = path; checksums = content; },
  };
  const built = await buildAll(deps);

  expect(builds.length).toBe(4);
  expect(built).toEqual(["grove-darwin-arm64", "grove-darwin-x64", "grove-linux-x64", "grove-linux-arm64"]);
  expect(checksumPath).toBe("/dist/SHASUMS256.txt");
  expect(checksums.trim().split("\n").length).toBe(4);
  expect(checksums).toContain("sha_grove-linux-x64  grove-linux-x64");
});
