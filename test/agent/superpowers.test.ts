import { test, expect } from "bun:test";
import { resolveSuperpowers, SUPERPOWERS_REF, type ResolveSuperpowersDeps } from "../../src/agent/superpowers.ts";

test("the fetch ref is pinned to a specific version tag (not an unpinned branch)", () => {
  expect(SUPERPOWERS_REF).toMatch(/^v\d+\.\d+\.\d+$/);
});

function deps(over: Partial<ResolveSuperpowersDeps> = {}): ResolveSuperpowersDeps {
  return {
    env: {},
    grovePluginsDir: "/home/.grove/plugins",
    installedPluginsJsonPath: "/home/.claude/plugins/installed_plugins.json",
    fileExists: () => false,
    readText: () => null,
    gitClone: async () => {},
    rmDir: async () => {},
    out: () => {},
    ...over,
  };
}
const manifest = (dir: string) => `${dir}/.claude-plugin/plugin.json`;

test("uses $GROVE_SUPERPOWERS_PATH when valid", async () => {
  const p = await resolveSuperpowers(deps({ env: { GROVE_SUPERPOWERS_PATH: "/custom/sp" }, fileExists: (x) => x === manifest("/custom/sp") }));
  expect(p).toBe("/custom/sp");
});

test("uses the user's installed superpowers plugin", async () => {
  const installed = JSON.stringify({ plugins: { "superpowers@official": [{ installPath: "/u/sp/5.1.0" }] } });
  const p = await resolveSuperpowers(deps({
    readText: (path) => (path.endsWith("installed_plugins.json") ? installed : null),
    fileExists: (x) => x === manifest("/u/sp/5.1.0"),
  }));
  expect(p).toBe("/u/sp/5.1.0");
});

test("uses grove's own copy if present", async () => {
  const p = await resolveSuperpowers(deps({ fileExists: (x) => x === manifest("/home/.grove/plugins/superpowers") }));
  expect(p).toBe("/home/.grove/plugins/superpowers");
});

test("fetches into grove's plugins dir when nothing is installed", async () => {
  const cloned: Array<{ url: string; dest: string }> = [];
  let done = false;
  const p = await resolveSuperpowers(deps({
    gitClone: async (url, dest) => { cloned.push({ url, dest }); done = true; },
    fileExists: (x) => done && x === manifest("/home/.grove/plugins/superpowers"),
  }));
  expect(cloned[0]!.url).toContain("github.com/obra/superpowers");
  expect(cloned[0]!.dest).toBe("/home/.grove/plugins/superpowers");
  expect(p).toBe("/home/.grove/plugins/superpowers");
});

test("clears a stale plugin dir (rmDir) BEFORE cloning, to survive an interrupted prior clone", async () => {
  const order: string[] = [];
  let done = false;
  await resolveSuperpowers(deps({
    rmDir: async (p) => { order.push(`rmDir:${p}`); },
    gitClone: async (_url, dest) => { order.push(`gitClone:${dest}`); done = true; },
    fileExists: (x) => done && x === manifest("/home/.grove/plugins/superpowers"),
  }));
  expect(order).toEqual([
    "rmDir:/home/.grove/plugins/superpowers",
    "gitClone:/home/.grove/plugins/superpowers",
  ]);
});

test("throws a clear error if the fetched plugin is still invalid", async () => {
  await expect(resolveSuperpowers(deps({ gitClone: async () => {}, fileExists: () => false }))).rejects.toThrow(/superpowers/i);
});
