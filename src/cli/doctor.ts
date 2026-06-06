import type { CommandRunner } from "../infra/command-runner.ts";
import { detectCredentials } from "../agent/credentials.ts";

export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DependencyCheck[];
  ok: boolean;
}

interface Dependency {
  name: string;
  cmd: string;
  args: string[];
}

const REQUIRED: Dependency[] = [
  { name: "git", cmd: "git", args: ["--version"] },
  { name: "docker", cmd: "docker", args: ["--version"] },
  { name: "docker compose", cmd: "docker", args: ["compose", "version"] },
];

export async function runDoctor(
  runner: CommandRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<DoctorReport> {
  const checks: DependencyCheck[] = [];
  for (const dep of REQUIRED) {
    const res = await runner.run(dep.cmd, dep.args);
    if (res.code === 0) {
      checks.push({ name: dep.name, ok: true, detail: res.stdout.trim() });
    } else {
      checks.push({
        name: dep.name,
        ok: false,
        detail: `not found or failed (exit ${res.code})`,
      });
    }
  }

  const cred = detectCredentials(env);
  checks.push({
    name: "anthropic credential",
    ok: cred.present,
    detail: cred.present
      ? `found (${cred.kind})`
      : "set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)",
  });

  return { checks, ok: checks.every((c) => c.ok) };
}
