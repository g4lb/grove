import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerComposeManager } from "../../src/infra/compose-manager.ts";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";

const ENABLED = process.env.GROVE_DOCKER_TESTS === "1";
const maybe = ENABLED ? test : test.skip;

let wt: string;
const taskId = "task_dockerit1";

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "grove-dockerit-"));
  // A trivial, fast service that exits immediately is not useful for `up -d`;
  // use a long-running tiny image so the container stays up.
  writeFileSync(
    join(wt, "docker-compose.yml"),
    "services:\n  sleeper:\n    image: busybox\n    command: sleep 300\n",
  );
});

afterEach(async () => {
  // Best-effort teardown even if the test failed mid-way.
  const mgr = new DockerComposeManager(new DockerRunner(new BunCommandRunner()));
  await mgr.down(taskId, wt).catch(() => {});
  rmSync(wt, { recursive: true, force: true });
});

maybe("up → status → down against real docker compose", async () => {
  const mgr = new DockerComposeManager(new DockerRunner(new BunCommandRunner()));

  const started = await mgr.up(taskId, wt);
  expect(started).toBe(true);

  const status = await mgr.status(taskId, wt);
  expect(status.toLowerCase()).toContain("sleeper");

  const stopped = await mgr.down(taskId, wt);
  expect(stopped).toBe(true);
}, 60000);
