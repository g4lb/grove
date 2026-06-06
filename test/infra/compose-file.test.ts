import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findComposeFile } from "../../src/infra/compose-file.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "grove-cf-"));
}

test("findComposeFile returns null when no compose file exists", () => {
  const dir = tempDir();
  try {
    expect(findComposeFile(dir)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findComposeFile finds docker-compose.yml", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
    expect(findComposeFile(dir)).toBe(join(dir, "docker-compose.yml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findComposeFile prefers docker-compose.yml over compose.yaml", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "compose.yaml"), "services: {}\n");
    writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
    expect(findComposeFile(dir)).toBe(join(dir, "docker-compose.yml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findComposeFile finds compose.yaml when it is the only one", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "compose.yaml"), "services: {}\n");
    expect(findComposeFile(dir)).toBe(join(dir, "compose.yaml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
