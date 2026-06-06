export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(cmd: string, args: string[]): Promise<CommandResult>;
}

export class BunCommandRunner implements CommandRunner {
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    try {
      const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      return { code, stdout, stderr };
    } catch {
      // Binary not found / not executable.
      return { code: 127, stdout: "", stderr: `command not found: ${cmd}` };
    }
  }
}
