#!/usr/bin/env bun
import { runDoctor } from "./doctor.ts";
import { BunCommandRunner } from "../infra/command-runner.ts";

const VERSION = "0.0.1";

function printUsage(): void {
  console.log("grove — usage: grove [doctor | --version]");
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
    default:
      printUsage();
      return 0;
  }
}

main(process.argv).then((code) => process.exit(code));
