import type { CommandRunner } from "./command-runner.ts";

export type DiskVerdict = "ok" | "warn" | "block";

export interface DiskThresholds {
  warnBytes: number;
  blockBytes: number;
}

export interface DiskMonitor {
  freeBytes(path: string): Promise<number>;
  evaluate(freeBytes: number, thresholds: DiskThresholds): DiskVerdict;
  groveUsageBytes(tasksDir: string): Promise<number>;
}

export class ShellDiskMonitor implements DiskMonitor {
  constructor(private runner: CommandRunner) {}

  async freeBytes(path: string): Promise<number> {
    // -P forces POSIX single-line output so the Available column stays at index 3 (GNU df wraps long device names).
    const res = await this.runner.run("df", ["-Pk", path]);
    if (res.code !== 0) {
      throw new Error(`df -k ${path} failed (exit ${res.code}): ${res.stderr.trim()}`);
    }
    const lines = res.stdout.trim().split("\n");
    const dataLine = lines[lines.length - 1]!;
    const cols = dataLine.trim().split(/\s+/);
    const availableKiB = Number(cols[3]);
    if (!Number.isFinite(availableKiB)) {
      throw new Error(`could not parse df output: ${dataLine}`);
    }
    return availableKiB * 1024;
  }

  evaluate(freeBytes: number, thresholds: DiskThresholds): DiskVerdict {
    if (freeBytes < thresholds.blockBytes) return "block";
    if (freeBytes < thresholds.warnBytes) return "warn";
    return "ok";
  }

  async groveUsageBytes(tasksDir: string): Promise<number> {
    // du exits 1 on permission warnings but still prints a valid running total to stdout,
    // so parse stdout first and only fall back to 0 when there's genuinely no number
    // (e.g. a missing directory prints nothing → NaN → 0).
    const res = await this.runner.run("du", ["-sk", tasksDir]);
    const firstCol = res.stdout.trim().split(/\s+/)[0];
    const kib = Number(firstCol);
    return Number.isFinite(kib) ? kib * 1024 : 0;
  }
}
