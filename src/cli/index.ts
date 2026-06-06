#!/usr/bin/env bun
import { runDoctor } from "./doctor.ts";
import { BunCommandRunner } from "../infra/command-runner.ts";
import { runInit } from "./init.ts";
import { resolvePaths } from "../config/paths.ts";
import { join } from "node:path";
import { homedir } from "node:os";

const VERSION = "0.0.1";

function printUsage(): void {
  console.log("grove — usage: grove [init | doctor | --version]");
}

function grovePaths() {
  const root = process.env.GROVE_HOME ?? join(homedir(), ".grove");
  return resolvePaths(root);
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];
  switch (cmd) {
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case "doctor": {
      const report = await runDoctor(new BunCommandRunner());
      for (const c of report.checks) {
        console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
      }
      console.log(report.ok ? "\nAll good." : "\nMissing dependencies — see above.");
      return report.ok ? 0 : 1;
    }
    case "init": {
      const result = await runInit({
        runner: new BunCommandRunner(),
        paths: grovePaths(),
        repoPath: process.cwd(),
      });
      console.log(`grove initialized at ${grovePaths().root}`);
      console.log(`${result.isGitRepo ? "✓" : "✗"} current directory is a git repo`);
      for (const c of result.doctor.checks) {
        console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
      }
      console.log(result.ok ? "\nReady." : "\nSetup incomplete — see above.");
      return result.ok ? 0 : 1;
    }
    default:
      printUsage();
      return 0;
  }
}

main(process.argv).then((code) => process.exit(code));
