# grove — Plan 3: Agent Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build grove's agent runtime — an `AgentRunner` interface that runs one bounded workflow phase as a Claude Agent SDK session, with phase definitions (self-contained per-phase methodology), a deterministic `FakeAgentRunner` for downstream tests, a real `SdkAgentRunner` adapter (SDK injected for testability), credential detection, and a `doctor` credential check.

**Architecture:** Mirrors the rest of grove — every boundary is an interface with an injectable adapter. `AgentRunner.run(phase, ctx)` is an `AsyncGenerator<AgentEvent, PhaseResult>` (yields streamed events, returns the final result), matching the SDK's own generator shape. The real adapter wraps `@anthropic-ai/claude-agent-sdk`'s `query()`, injected via a `QueryFn` so unit tests use a scripted fake (no subprocess, no API). The workflow methodology is encoded in each phase's system-prompt append (the `claude_code` preset + phase instructions) — self-contained, no external skills. One live end-to-end test is gated behind `GROVE_AGENT_TESTS=1`.

**Tech Stack:** Bun (`bun test`), TypeScript (strict), `@anthropic-ai/claude-agent-sdk`, Plan 1 modules (`Store` domain `Phase` type, `GroveConfig`/`loadConfig`, `runDoctor`).

---

## Context for the implementer (read once)

Plans 1, 2a, 2b are merged on `main`. Relevant existing code:
- `src/domain/types.ts` — `Phase = "brainstorm" | "plan" | "execute" | "review" | "finish"`.
- `src/config/config.ts` — `GroveConfig`, `DEFAULT_CONFIG`, `loadConfig(paths)`, `saveConfig(paths, config)` (shallow-merges per top-level key over defaults).
- `src/cli/doctor.ts` — `runDoctor(runner): Promise<DoctorReport>`, `DoctorReport { checks: DependencyCheck[]; ok }`, `DependencyCheck { name, ok, detail }`.
- `src/infra/command-runner.ts` — `CommandRunner` (only relevant if a task needs it; agent runtime does not shell out directly).

**SDK facts (verified against `@anthropic-ai/claude-agent-sdk@0.3.x`):**
- Named export `query({ prompt, options }): AsyncGenerator<SDKMessage, void>`.
- It spawns the bundled native `claude` binary as a subprocess (resolves from `node_modules` in dev — fine here; the compiled-binary packaging of that native binary is OUT of scope, deferred to a packaging plan).
- **No `apiKey` option** — auth is env-driven. Pass credentials via `options.env`. `ANTHROPIC_API_KEY` is the product-sanctioned path; `CLAUDE_CODE_OAUTH_TOKEN` also works for local use (API key wins if both set).
- Relevant `options`: `systemPrompt` (use `{ type: "preset", preset: "claude_code", append }`), `cwd`, `model`, `maxTurns`, `permissionMode` (`"bypassPermissions"` = auto-approve all tools, matching grove's "auto-approve within task scope" decision), `includePartialMessages: true` (stream token deltas as `stream_event`), `env`, `abortController`.
- `SDKMessage` variants we read: `{ type:"system", subtype:"init", session_id }`; `{ type:"stream_event", event }` where `event.type==="content_block_delta"` and `event.delta.type==="text_delta"` has `event.delta.text`; `{ type:"assistant", message:{ content: Array<{type, name?, input?, text?}> } }` (tool_use blocks have `type:"tool_use"`, `name`, `input`); `{ type:"result", subtype, result, total_cost_usd }` (`subtype:"success"` is the happy path).

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command (state does not persist between calls). Verify: `export PATH="$HOME/.bun/bin:$PATH"; bun --version` → `1.3.14`.

Imports use explicit `.ts` extensions. TDD throughout. One logical change per commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/agent/events.ts` | `AgentEvent` union + `PhaseResult` + `PhaseContext` types |
| `src/agent/agent-runner.ts` | `AgentRunner` interface |
| `src/agent/phases.ts` | `phaseDefinition(phase)` — per-phase system-prompt append, artifact path, maxTurns; `buildPrompt(phase, ctx)` |
| `src/agent/credentials.ts` | `detectCredentials()` / `hasCredentials()` / `credentialEnv()` — `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` |
| `src/agent/fake-agent-runner.ts` | `FakeAgentRunner` — scripted, deterministic (used by Plan 4 engine tests) |
| `src/agent/sdk-agent-runner.ts` | `SdkAgentRunner` — real adapter over injected `QueryFn`, maps `SDKMessage`→`AgentEvent` |
| `src/config/config.ts` | (modify) add `agent.model` to `GroveConfig` |
| `src/cli/doctor.ts` | (modify) add a credential check |
| `test/agent/*`, `test/config/*`, `test/cli/*` | one test file per module |

---

## Task 1: Add the SDK dependency + core agent types

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/agent/events.ts`
- Create: `src/agent/agent-runner.ts`
- Test: `test/agent/events.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun add @anthropic-ai/claude-agent-sdk`
Expected: installs `@anthropic-ai/claude-agent-sdk` (and its platform-specific native binary as an optional dep) into `node_modules`; `package.json` `dependencies` now lists it. (If the optional native binary fails to install on this platform, that's OK — unit tests inject a fake and never spawn it.)

- [ ] **Step 2: Write the failing test**

`test/agent/events.test.ts`:
```typescript
import { test, expect } from "bun:test";
import type { AgentEvent, PhaseResult, PhaseContext } from "../../src/agent/events.ts";

test("AgentEvent union members are constructable", () => {
  const token: AgentEvent = { type: "token", text: "hi" };
  const toolUse: AgentEvent = { type: "tool_use", tool: "Write", input: { path: "a" } };
  const notice: AgentEvent = { type: "notice", message: "starting" };
  expect(token.type).toBe("token");
  expect(toolUse.tool).toBe("Write");
  expect(notice.message).toBe("starting");
});

test("PhaseResult and PhaseContext shapes hold", () => {
  const result: PhaseResult = {
    success: true,
    summary: "done",
    artifactPath: "/wt/.grove/design.md",
    costUsd: 0.01,
    sessionId: "s1",
  };
  const ctx: PhaseContext = {
    taskId: "task_1",
    title: "Add login",
    description: "OAuth",
    worktreePath: "/wt",
    model: "claude-opus-4-8",
    priorArtifacts: [{ phase: "brainstorm", path: "/wt/.grove/design.md" }],
  };
  expect(result.success).toBe(true);
  expect(ctx.priorArtifacts[0]!.phase).toBe("brainstorm");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/events.test.ts`
Expected: FAIL — "Cannot find module '../../src/agent/events.ts'".

- [ ] **Step 4: Write the implementations**

`src/agent/events.ts`:
```typescript
import type { Phase } from "../domain/types.ts";

/** A streamed event emitted while an agent phase runs. */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "notice"; message: string };

/** The terminal outcome of a phase run. */
export interface PhaseResult {
  success: boolean;
  summary: string;
  /** Absolute path to the phase's gate artifact, or null if the phase produces no file (e.g. execute). */
  artifactPath: string | null;
  costUsd: number;
  /** The SDK session id, for chaining context into the next phase. */
  sessionId: string | null;
}

/** Everything a phase run needs. `worktreePath` is the agent's cwd. */
export interface PhaseContext {
  taskId: string;
  title: string;
  description?: string;
  worktreePath: string;
  model: string;
  /** Artifacts produced by earlier phases, passed forward as context. */
  priorArtifacts: Array<{ phase: Phase; path: string }>;
}
```

`src/agent/agent-runner.ts`:
```typescript
import type { Phase } from "../domain/types.ts";
import type { AgentEvent, PhaseResult, PhaseContext } from "./events.ts";

/**
 * Runs a single bounded workflow phase. Yields streamed AgentEvents as the agent
 * works, and returns the final PhaseResult when the phase completes.
 */
export interface AgentRunner {
  run(phase: Phase, context: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/events.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/agent/events.ts src/agent/agent-runner.ts test/agent/events.test.ts
git commit -m "feat: add Claude Agent SDK dep and core agent runtime types"
```

---

## Task 2: Phase definitions

**Files:**
- Create: `src/agent/phases.ts`
- Test: `test/agent/phases.test.ts`

Per-phase methodology (system-prompt append), expected artifact path (relative to the worktree), and a turn cap. `buildPrompt` assembles the task-specific prompt including prior-artifact references.

- [ ] **Step 1: Write the failing test**

`test/agent/phases.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { phaseDefinition, buildPrompt } from "../../src/agent/phases.ts";
import type { PhaseContext } from "../../src/agent/events.ts";

const ctx: PhaseContext = {
  taskId: "task_1",
  title: "Add OAuth login",
  description: "Support Google sign-in",
  worktreePath: "/wt",
  model: "claude-opus-4-8",
  priorArtifacts: [{ phase: "brainstorm", path: "/wt/.grove/design.md" }],
};

test("every phase has a definition with a non-empty system prompt and turn cap", () => {
  for (const phase of ["brainstorm", "plan", "execute", "review", "finish"] as const) {
    const def = phaseDefinition(phase);
    expect(def.systemPromptAppend.length).toBeGreaterThan(0);
    expect(def.maxTurns).toBeGreaterThan(0);
  }
});

test("brainstorm and plan produce a .grove artifact; execute and finish do not", () => {
  expect(phaseDefinition("brainstorm").artifactRelPath).toBe(".grove/design.md");
  expect(phaseDefinition("plan").artifactRelPath).toBe(".grove/plan.md");
  expect(phaseDefinition("review").artifactRelPath).toBe(".grove/review.md");
  expect(phaseDefinition("execute").artifactRelPath).toBeNull();
  expect(phaseDefinition("finish").artifactRelPath).toBeNull();
});

test("buildPrompt includes the task title, description, and prior artifact paths", () => {
  const prompt = buildPrompt("plan", ctx);
  expect(prompt).toContain("Add OAuth login");
  expect(prompt).toContain("Support Google sign-in");
  expect(prompt).toContain("/wt/.grove/design.md");
});

test("buildPrompt for brainstorm works with no prior artifacts", () => {
  const prompt = buildPrompt("brainstorm", { ...ctx, priorArtifacts: [] });
  expect(prompt).toContain("Add OAuth login");
  expect(prompt).not.toContain("Prior artifacts");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/phases.test.ts`
Expected: FAIL — "Cannot find module '../../src/agent/phases.ts'".

- [ ] **Step 3: Write the implementation**

`src/agent/phases.ts`:
```typescript
import type { Phase } from "../domain/types.ts";
import type { PhaseContext } from "./events.ts";

export interface PhaseDefinition {
  /** Appended to the claude_code system-prompt preset; encodes the phase methodology. */
  systemPromptAppend: string;
  /** Worktree-relative path of the gate artifact this phase should produce, or null. */
  artifactRelPath: string | null;
  /** Caps the agentic loop for this phase. */
  maxTurns: number;
}

const DEFINITIONS: Record<Phase, PhaseDefinition> = {
  brainstorm: {
    systemPromptAppend:
      "You are in grove's BRAINSTORM phase. Explore the request, clarify scope, and " +
      "weigh approaches. Write a concise design document to `.grove/design.md` covering " +
      "the chosen approach, the components involved, and key trade-offs. Do NOT write " +
      "implementation code in this phase.",
    artifactRelPath: ".grove/design.md",
    maxTurns: 30,
  },
  plan: {
    systemPromptAppend:
      "You are in grove's PLAN phase. Read `.grove/design.md`. Produce a step-by-step " +
      "implementation plan at `.grove/plan.md` as bite-sized, independently testable tasks " +
      "(test-driven where possible). Do NOT implement the code yet.",
    artifactRelPath: ".grove/plan.md",
    maxTurns: 30,
  },
  execute: {
    systemPromptAppend:
      "You are in grove's EXECUTE phase. Read `.grove/plan.md` and implement it task by " +
      "task, writing tests first where practical and committing as you complete each step. " +
      "Ensure the test suite passes before finishing.",
    artifactRelPath: null,
    maxTurns: 80,
  },
  review: {
    systemPromptAppend:
      "You are in grove's REVIEW phase. Review the changes on this branch for correctness, " +
      "edge cases, and quality. Write your findings (with file:line references and severity) " +
      "to `.grove/review.md`.",
    artifactRelPath: ".grove/review.md",
    maxTurns: 30,
  },
  finish: {
    systemPromptAppend:
      "You are in grove's FINISH phase. Make sure the test suite passes, then prepare the " +
      "branch for integration: ensure all work is committed with a clear message and produce " +
      "a short summary of what changed.",
    artifactRelPath: null,
    maxTurns: 15,
  },
};

export function phaseDefinition(phase: Phase): PhaseDefinition {
  return DEFINITIONS[phase];
}

/** Build the task-specific prompt for a phase, threading prior artifacts forward. */
export function buildPrompt(phase: Phase, ctx: PhaseContext): string {
  const lines: string[] = [];
  lines.push(`Task: ${ctx.title}`);
  if (ctx.description) lines.push(`Details: ${ctx.description}`);
  if (ctx.priorArtifacts.length > 0) {
    lines.push("");
    lines.push("Prior artifacts (read these for context):");
    for (const a of ctx.priorArtifacts) lines.push(`- ${a.phase}: ${a.path}`);
  }
  lines.push("");
  lines.push(`Begin the ${phase} phase now.`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/phases.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/phases.ts test/agent/phases.test.ts
git commit -m "feat: add per-phase definitions and prompt builder"
```

---

## Task 3: Credential detection

**Files:**
- Create: `src/agent/credentials.ts`
- Test: `test/agent/credentials.test.ts`

Detects which Anthropic credential is available so `doctor` can validate it and the adapter can pass it to the SDK subprocess. Takes the env as an argument so it's testable without touching `process.env`.

- [ ] **Step 1: Write the failing test**

`test/agent/credentials.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { detectCredentials, hasCredentials, credentialEnv } from "../../src/agent/credentials.ts";

test("detectCredentials prefers ANTHROPIC_API_KEY (the sanctioned path)", () => {
  const d = detectCredentials({ ANTHROPIC_API_KEY: "sk-1", CLAUDE_CODE_OAUTH_TOKEN: "oauth-1" });
  expect(d.kind).toBe("api_key");
  expect(d.present).toBe(true);
});

test("detectCredentials falls back to the OAuth token", () => {
  const d = detectCredentials({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-1" });
  expect(d.kind).toBe("oauth_token");
  expect(d.present).toBe(true);
});

test("detectCredentials reports none when neither is set", () => {
  const d = detectCredentials({});
  expect(d.present).toBe(false);
  expect(d.kind).toBe("none");
});

test("hasCredentials is a boolean shortcut", () => {
  expect(hasCredentials({ ANTHROPIC_API_KEY: "x" })).toBe(true);
  expect(hasCredentials({})).toBe(false);
});

test("credentialEnv passes through only the credential vars that are set", () => {
  const env = credentialEnv({ ANTHROPIC_API_KEY: "sk-1", PATH: "/bin", FOO: "bar" });
  expect(env.ANTHROPIC_API_KEY).toBe("sk-1");
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  // it does not leak unrelated vars
  expect((env as Record<string, unknown>).FOO).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/credentials.test.ts`
Expected: FAIL — "Cannot find module '../../src/agent/credentials.ts'".

- [ ] **Step 3: Write the implementation**

`src/agent/credentials.ts`:
```typescript
export type CredentialKind = "api_key" | "oauth_token" | "none";

export interface CredentialInfo {
  present: boolean;
  kind: CredentialKind;
}

type Env = Record<string, string | undefined>;

/**
 * Detect which Anthropic credential is available. ANTHROPIC_API_KEY is the
 * product-sanctioned path and takes precedence (it also wins inside the SDK
 * subprocess when both are set); CLAUDE_CODE_OAUTH_TOKEN is the local fallback.
 */
export function detectCredentials(env: Env): CredentialInfo {
  if (env.ANTHROPIC_API_KEY) return { present: true, kind: "api_key" };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { present: true, kind: "oauth_token" };
  return { present: false, kind: "none" };
}

export function hasCredentials(env: Env): boolean {
  return detectCredentials(env).present;
}

/** The credential-only env to hand to the SDK subprocess (no unrelated vars leaked). */
export function credentialEnv(env: Env): Env {
  const out: Env = {};
  if (env.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) out.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/credentials.test.ts`
Expected: PASS — 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/credentials.ts test/agent/credentials.test.ts
git commit -m "feat: add Anthropic credential detection"
```

---

## Task 4: Add `agent.model` to config

**Files:**
- Modify: `src/config/config.ts`
- Test: `test/config/config.agent.test.ts`

Extends `GroveConfig` with an `agent.model` (default `claude-opus-4-8`), merged over defaults like the existing `disk` section.

- [ ] **Step 1: Write the failing test**

`test/config/config.agent.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/config/paths.ts";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../../src/config/config.ts";

function tempPaths() {
  return resolvePaths(mkdtempSync(join(tmpdir(), "grove-")));
}

test("default agent.model is claude-opus-4-8", () => {
  expect(DEFAULT_CONFIG.agent.model).toBe("claude-opus-4-8");
});

test("loadConfig returns the default agent.model when no file exists", async () => {
  const cfg = await loadConfig(tempPaths());
  expect(cfg.agent.model).toBe("claude-opus-4-8");
});

test("a partial config file overriding agent.model is merged over defaults", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, JSON.stringify({ agent: { model: "claude-sonnet-4-6" } }));
  const cfg = await loadConfig(paths);
  expect(cfg.agent.model).toBe("claude-sonnet-4-6");
  // disk defaults still present (independent section)
  expect(cfg.disk.warnBytes).toBe(DEFAULT_CONFIG.disk.warnBytes);
});

test("a config file overriding only disk keeps the default agent.model", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, JSON.stringify({ disk: { warnBytes: 5 } }));
  const cfg = await loadConfig(paths);
  expect(cfg.agent.model).toBe("claude-opus-4-8");
  expect(cfg.disk.warnBytes).toBe(5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/config/config.agent.test.ts`
Expected: FAIL — `DEFAULT_CONFIG.agent` is undefined.

- [ ] **Step 3: Update `src/config/config.ts`**

The current file is:
```typescript
import type { GrovePaths } from "./paths.ts";

export interface GroveConfig {
  disk: {
    warnBytes: number;
    blockBytes: number;
  };
}

export const DEFAULT_CONFIG: GroveConfig = {
  disk: {
    warnBytes: 10 * 1024 ** 3, // 10 GB
    blockBytes: 2 * 1024 ** 3, //  2 GB
  },
};

export async function loadConfig(paths: GrovePaths): Promise<GroveConfig> {
  const file = Bun.file(paths.configFile);
  if (!(await file.exists())) return { disk: { ...DEFAULT_CONFIG.disk } };
  let parsed: Partial<GroveConfig>;
  try {
    parsed = (await file.json()) as Partial<GroveConfig>;
  } catch {
    return { disk: { ...DEFAULT_CONFIG.disk } };
  }
  return {
    disk: { ...DEFAULT_CONFIG.disk, ...(parsed.disk ?? {}) },
  };
}

export async function saveConfig(paths: GrovePaths, config: GroveConfig): Promise<void> {
  await Bun.write(paths.configFile, JSON.stringify(config, null, 2));
}
```

Change it to add the `agent` section (note: each top-level section is spread independently — the same shallow-merge-per-section pattern, which is the carry-forward noted in Plan 2b):
```typescript
import type { GrovePaths } from "./paths.ts";

export interface GroveConfig {
  disk: {
    warnBytes: number;
    blockBytes: number;
  };
  agent: {
    model: string;
  };
}

export const DEFAULT_CONFIG: GroveConfig = {
  disk: {
    warnBytes: 10 * 1024 ** 3, // 10 GB
    blockBytes: 2 * 1024 ** 3, //  2 GB
  },
  agent: {
    model: "claude-opus-4-8",
  },
};

function withDefaults(parsed: Partial<GroveConfig>): GroveConfig {
  return {
    disk: { ...DEFAULT_CONFIG.disk, ...(parsed.disk ?? {}) },
    agent: { ...DEFAULT_CONFIG.agent, ...(parsed.agent ?? {}) },
  };
}

export async function loadConfig(paths: GrovePaths): Promise<GroveConfig> {
  const file = Bun.file(paths.configFile);
  if (!(await file.exists())) return withDefaults({});
  let parsed: Partial<GroveConfig>;
  try {
    parsed = (await file.json()) as Partial<GroveConfig>;
  } catch {
    // Malformed config file — fall back to defaults rather than breaking every command.
    return withDefaults({});
  }
  return withDefaults(parsed);
}

export async function saveConfig(paths: GrovePaths, config: GroveConfig): Promise<void> {
  await Bun.write(paths.configFile, JSON.stringify(config, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/config/config.agent.test.ts test/config/config.test.ts`
Expected: PASS — the new 4 tests plus the existing config tests (the `withDefaults` refactor preserves the no-file fresh-copy and malformed-JSON fallback behavior the existing tests assert).

- [ ] **Step 5: Commit**

```bash
git add src/config/config.ts test/config/config.agent.test.ts
git commit -m "feat: add agent.model to GroveConfig (default claude-opus-4-8)"
```

---

## Task 5: FakeAgentRunner

**Files:**
- Create: `src/agent/fake-agent-runner.ts`
- Test: `test/agent/fake-agent-runner.test.ts`

A deterministic `AgentRunner` that yields a scripted list of events and returns a scripted result. This is what the Plan 4 engine's unit tests will use to drive phases without any SDK/API.

- [ ] **Step 1: Write the failing test**

`test/agent/fake-agent-runner.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { FakeAgentRunner } from "../../src/agent/fake-agent-runner.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "../../src/agent/events.ts";

const ctx: PhaseContext = {
  taskId: "task_1",
  title: "x",
  worktreePath: "/wt",
  model: "m",
  priorArtifacts: [],
};

test("FakeAgentRunner yields scripted events and returns the scripted result", async () => {
  const events: AgentEvent[] = [
    { type: "notice", message: "start" },
    { type: "token", text: "hello" },
    { type: "tool_use", tool: "Write", input: { path: ".grove/design.md" } },
  ];
  const result: PhaseResult = {
    success: true,
    summary: "designed",
    artifactPath: "/wt/.grove/design.md",
    costUsd: 0,
    sessionId: "s1",
  };
  const runner = new FakeAgentRunner({ brainstorm: { events, result } });

  const seen: AgentEvent[] = [];
  const gen = runner.run("brainstorm", ctx);
  let next = await gen.next();
  while (!next.done) {
    seen.push(next.value);
    next = await gen.next();
  }
  expect(seen).toEqual(events);
  expect(next.value).toEqual(result);
});

test("FakeAgentRunner records the calls it received", async () => {
  const runner = new FakeAgentRunner({
    plan: { events: [], result: { success: true, summary: "", artifactPath: null, costUsd: 0, sessionId: null } },
  });
  const gen = runner.run("plan", ctx);
  while (!(await gen.next()).done) { /* drain */ }
  expect(runner.calls).toEqual([{ phase: "plan", taskId: "task_1" }]);
});

test("FakeAgentRunner throws for an unscripted phase", async () => {
  const runner = new FakeAgentRunner({});
  const gen = runner.run("execute", ctx);
  await expect(gen.next()).rejects.toThrow("no script for phase: execute");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/fake-agent-runner.test.ts`
Expected: FAIL — "Cannot find module '../../src/agent/fake-agent-runner.ts'".

- [ ] **Step 3: Write the implementation**

`src/agent/fake-agent-runner.ts`:
```typescript
import type { Phase } from "../domain/types.ts";
import type { AgentRunner } from "./agent-runner.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "./events.ts";

export interface PhaseScript {
  events: AgentEvent[];
  result: PhaseResult;
}

/** Deterministic AgentRunner driven by a per-phase script. For tests and the engine. */
export class FakeAgentRunner implements AgentRunner {
  calls: Array<{ phase: Phase; taskId: string }> = [];

  constructor(private scripts: Partial<Record<Phase, PhaseScript>>) {}

  async *run(phase: Phase, context: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult> {
    this.calls.push({ phase, taskId: context.taskId });
    const script = this.scripts[phase];
    if (!script) throw new Error(`no script for phase: ${phase}`);
    for (const event of script.events) {
      yield event;
    }
    return script.result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/fake-agent-runner.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/fake-agent-runner.ts test/agent/fake-agent-runner.test.ts
git commit -m "feat: add FakeAgentRunner for deterministic phase tests"
```

---

## Task 6: SdkAgentRunner (real adapter, SDK injected)

**Files:**
- Create: `src/agent/sdk-agent-runner.ts`
- Test: `test/agent/sdk-agent-runner.test.ts`

Wraps the SDK's `query()`, injected as a `QueryFn` so the unit test passes a scripted fake (no subprocess, no API). Maps `SDKMessage` → `AgentEvent` and assembles the `PhaseResult`.

- [ ] **Step 1: Write the failing test**

`test/agent/sdk-agent-runner.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { SdkAgentRunner, type QueryFn } from "../../src/agent/sdk-agent-runner.ts";
import type { AgentEvent, PhaseContext } from "../../src/agent/events.ts";

const ctx: PhaseContext = {
  taskId: "task_1",
  title: "Add login",
  worktreePath: "/wt",
  model: "claude-opus-4-8",
  priorArtifacts: [],
};

// A fake query() that yields a realistic SDKMessage sequence.
function fakeQuery(messages: unknown[]): QueryFn {
  return ((_args: unknown) => {
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  }) as unknown as QueryFn;
}

test("maps stream tokens and tool_use blocks to AgentEvents and returns a success result", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { path: ".grove/design.md" } }] } },
      { type: "result", subtype: "success", result: "design complete", total_cost_usd: 0.02 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });

  const seen: AgentEvent[] = [];
  const gen = runner.run("brainstorm", ctx);
  let next = await gen.next();
  while (!next.done) {
    seen.push(next.value);
    next = await gen.next();
  }

  expect(seen).toContainEqual({ type: "token", text: "Hello" });
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: { path: ".grove/design.md" } });
  const result = next.value;
  expect(result.success).toBe(true);
  expect(result.summary).toBe("design complete");
  expect(result.costUsd).toBe(0.02);
  expect(result.sessionId).toBe("sess-1");
  // brainstorm produces an artifact under the worktree
  expect(result.artifactPath).toBe("/wt/.grove/design.md");
});

test("returns success:false when the result subtype is an error", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "s" },
      { type: "result", subtype: "error_max_turns", result: "", total_cost_usd: 0.01 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });
  const gen = runner.run("execute", ctx);
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  expect(next.value.success).toBe(false);
  expect(next.value.summary).toContain("error_max_turns");
  // execute has no artifact
  expect(next.value.artifactPath).toBeNull();
});

test("passes phase options into query (cwd, model, bypassPermissions, append, env)", async () => {
  let captured: any;
  const queryFn = ((args: any) => {
    captured = args;
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", result: "ok", total_cost_usd: 0 };
    }
    return gen();
  }) as unknown as QueryFn;

  const runner = new SdkAgentRunner({ queryFn, env: { ANTHROPIC_API_KEY: "sk-test", FOO: "bar" } });
  const gen = runner.run("plan", ctx);
  while (!(await gen.next()).done) { /* drain */ }

  expect(captured.options.cwd).toBe("/wt");
  expect(captured.options.model).toBe("claude-opus-4-8");
  expect(captured.options.permissionMode).toBe("bypassPermissions");
  expect(captured.options.systemPrompt.preset).toBe("claude_code");
  expect(captured.options.systemPrompt.append.length).toBeGreaterThan(0);
  expect(captured.options.maxTurns).toBeGreaterThan(0);
  // only credential vars passed, not FOO
  expect(captured.options.env.ANTHROPIC_API_KEY).toBe("sk-test");
  expect(captured.options.env.FOO).toBeUndefined();
  // the prompt carries the task title
  expect(captured.prompt).toContain("Add login");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/sdk-agent-runner.test.ts`
Expected: FAIL — "Cannot find module '../../src/agent/sdk-agent-runner.ts'".

- [ ] **Step 3: Write the implementation**

`src/agent/sdk-agent-runner.ts`:
```typescript
import { join } from "node:path";
import { query as realQuery } from "@anthropic-ai/claude-agent-sdk";
import type { Phase } from "../domain/types.ts";
import type { AgentRunner } from "./agent-runner.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "./events.ts";
import { phaseDefinition, buildPrompt } from "./phases.ts";
import { credentialEnv } from "./credentials.ts";

/** The shape of the SDK's query() that we depend on (injected for testability). */
export type QueryFn = typeof realQuery;

export interface SdkAgentRunnerOptions {
  /** Defaults to the real SDK query(); tests inject a fake. */
  queryFn?: QueryFn;
  /** The environment to derive credentials from (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export class SdkAgentRunner implements AgentRunner {
  private queryFn: QueryFn;
  private env: Record<string, string | undefined>;

  constructor(opts: SdkAgentRunnerOptions = {}) {
    this.queryFn = opts.queryFn ?? realQuery;
    this.env = opts.env ?? process.env;
  }

  async *run(phase: Phase, ctx: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult> {
    const def = phaseDefinition(phase);
    const artifactPath = def.artifactRelPath ? join(ctx.worktreePath, def.artifactRelPath) : null;

    const stream = this.queryFn({
      prompt: buildPrompt(phase, ctx),
      options: {
        systemPrompt: { type: "preset", preset: "claude_code", append: def.systemPromptAppend },
        cwd: ctx.worktreePath,
        model: ctx.model,
        maxTurns: def.maxTurns,
        permissionMode: "bypassPermissions",
        includePartialMessages: true,
        env: credentialEnv(this.env),
      },
    } as Parameters<QueryFn>[0]);

    let sessionId: string | null = null;
    let summary = "";
    let costUsd = 0;
    let success = false;

    for await (const m of stream as AsyncIterable<any>) {
      if (m.type === "system" && m.subtype === "init") {
        sessionId = m.session_id ?? null;
        yield { type: "notice", message: `phase ${phase} started` };
      } else if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          yield { type: "token", text: ev.delta.text };
        }
      } else if (m.type === "assistant") {
        for (const block of m.message?.content ?? []) {
          if (block.type === "tool_use") {
            yield { type: "tool_use", tool: block.name, input: block.input };
          }
        }
      } else if (m.type === "result") {
        costUsd = m.total_cost_usd ?? 0;
        if (m.subtype === "success") {
          success = true;
          summary = m.result ?? "";
        } else {
          success = false;
          summary = `phase ${phase} did not complete: ${m.subtype}`;
        }
      }
    }

    return { success, summary, artifactPath, costUsd, sessionId };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/sdk-agent-runner.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass; `tsc --noEmit` clean. (If typecheck complains about the SDK's `query` types not matching the `as Parameters<QueryFn>[0]` cast, keep the casts shown — they intentionally decouple from the exact evolving SDK option types.)

- [ ] **Step 6: Commit**

```bash
git add src/agent/sdk-agent-runner.ts test/agent/sdk-agent-runner.test.ts
git commit -m "feat: add SdkAgentRunner adapter over the Claude Agent SDK"
```

---

## Task 7: Live smoke test (flag-gated)

**Files:**
- Test: `test/agent/sdk-agent-runner.integration.test.ts`

Runs ONE real phase against the real SDK + a real credential, only when `GROVE_AGENT_TESTS=1`. Keeps the default suite free of API calls / subprocess / cost.

- [ ] **Step 1: Write the test**

`test/agent/sdk-agent-runner.integration.test.ts`:
```typescript
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import { hasCredentials } from "../../src/agent/credentials.ts";
import type { PhaseContext } from "../../src/agent/events.ts";

const ENABLED = process.env.GROVE_AGENT_TESTS === "1" && hasCredentials(process.env);
const maybe = ENABLED ? test : test.skip;

let wt: string;
beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "grove-agentit-"));
});
afterEach(() => {
  rmSync(wt, { recursive: true, force: true });
});

maybe("runs a real brainstorm phase end-to-end and produces a result", async () => {
  const runner = new SdkAgentRunner(); // real query(), real credentials from process.env
  const ctx: PhaseContext = {
    taskId: "task_smoke1",
    title: "Add a function that returns the string 'hello'",
    description: "Keep it trivial; this is a smoke test.",
    worktreePath: wt,
    model: process.env.GROVE_AGENT_MODEL ?? "claude-opus-4-8",
    priorArtifacts: [],
  };

  let sawAnyEvent = false;
  const gen = runner.run("brainstorm", ctx);
  let next = await gen.next();
  while (!next.done) {
    sawAnyEvent = true;
    next = await gen.next();
  }
  const result = next.value;
  expect(sawAnyEvent).toBe(true);
  expect(typeof result.summary).toBe("string");
  expect(result.success).toBe(true);
}, 180000);
```

- [ ] **Step 2: Run the test (default: skipped)**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/sdk-agent-runner.integration.test.ts`
Expected: PASS — the test is **skipped** (no `GROVE_AGENT_TESTS=1`), suite passes, no API call.

- [ ] **Step 3: (Optional) run it for real**

Run: `export PATH="$HOME/.bun/bin:$PATH"; GROVE_AGENT_TESTS=1 bun test test/agent/sdk-agent-runner.integration.test.ts`
This needs `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) set and makes a real (cheap) API call. OPTIONAL — skip if no credential is available; it does not gate the plan. Report what happened if you run it.

- [ ] **Step 4: Commit**

```bash
git add test/agent/sdk-agent-runner.integration.test.ts
git commit -m "test: flag-gated live smoke test for SdkAgentRunner"
```

---

## Task 8: Add a credential check to `doctor`

**Files:**
- Modify: `src/cli/doctor.ts`
- Test: `test/cli/doctor.credentials.test.ts`

`runDoctor` gains a check that an Anthropic credential is configured (so a phase never fails deep for a missing key). It reads the env, so the test injects one.

- [ ] **Step 1: Write the failing test**

`test/cli/doctor.credentials.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { runDoctor } from "../../src/cli/doctor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}
const OK = (s = ""): CommandResult => ({ code: 0, stdout: s, stderr: "" });
const allTools = new MapRunner((cmd, args) => {
  if (cmd === "git") return OK("git version 2.45.0");
  if (cmd === "docker" && args.includes("compose")) return OK("v2.29.0");
  if (cmd === "docker") return OK("Docker version 27.0.0");
  return { code: 127, stdout: "", stderr: "not found" };
});

test("doctor passes the credential check when ANTHROPIC_API_KEY is set", async () => {
  const report = await runDoctor(allTools, { ANTHROPIC_API_KEY: "sk-1" });
  const cred = report.checks.find((c) => c.name === "anthropic credential")!;
  expect(cred.ok).toBe(true);
  expect(report.ok).toBe(true);
});

test("doctor fails the credential check when no credential is set", async () => {
  const report = await runDoctor(allTools, {});
  const cred = report.checks.find((c) => c.name === "anthropic credential")!;
  expect(cred.ok).toBe(false);
  expect(report.ok).toBe(false);
});

test("runDoctor still works without an env argument (defaults to process.env)", async () => {
  const report = await runDoctor(allTools);
  expect(report.checks.some((c) => c.name === "anthropic credential")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/doctor.credentials.test.ts`
Expected: FAIL — `runDoctor` takes only one argument and emits no "anthropic credential" check.

- [ ] **Step 3: Update `src/cli/doctor.ts`**

Add the import at the top:
```typescript
import { detectCredentials } from "../agent/credentials.ts";
```

Change the `runDoctor` signature and append the credential check. The current function is:
```typescript
export async function runDoctor(runner: CommandRunner): Promise<DoctorReport> {
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
  return { checks, ok: checks.every((c) => c.ok) };
}
```
Change it to:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/doctor.credentials.test.ts test/cli/doctor.test.ts`
Expected: PASS — the new 3 tests, plus the existing doctor tests. NOTE: the existing `test/cli/doctor.test.ts` calls `runDoctor(runner)` and asserts `report.ok` is true when all deps are present — but now the credential check will FAIL in that test's environment unless a credential is set. To keep the existing test valid, it must pass an env with a credential. If the existing doctor test now fails on `report.ok`, update ONLY that test's `runDoctor(...)` calls to pass a credential env: change `runDoctor(runner)` → `runDoctor(runner, { ANTHROPIC_API_KEY: "sk-test" })` in the "reports ok when all dependencies are present" case, and leave the "docker missing" case as-is (it already expects `ok:false`). This is a legitimate test update (the contract changed: doctor now also requires a credential), not weakening it.

- [ ] **Step 5: Run the full suite, typecheck, and CLI build smoke**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && ANTHROPIC_API_KEY=sk-test GROVE_HOME=/tmp/grove-doc ./dist/grove doctor; rm -rf /tmp/grove-doc`
Expected: all tests PASS (2 skips now: the docker + agent integration tests); `tsc --noEmit` clean; binary builds; `grove doctor` lists git/docker/compose + an "anthropic credential" line.

- [ ] **Step 6: Commit**

```bash
git add src/cli/doctor.ts test/cli/doctor.credentials.test.ts test/cli/doctor.test.ts
git commit -m "feat: doctor checks for an Anthropic credential"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 3 slice of §6):**
- One bounded agent session per phase, `cwd` = worktree, phase-specific system prompt, completion artifact (§6.1) → Tasks 2, 6 ✓
- `AgentRunner` interface `run(phase, context) → stream + PhaseResult` (§6.2) → Tasks 1, 6 ✓ (modeled as `AsyncGenerator<AgentEvent, PhaseResult>`)
- Events stream up for the future TUI feed (§6.2) → `AgentEvent` (token/tool_use/notice), Task 1/6 ✓
- Context handoff via artifacts, not transcripts (§6.3) → `PhaseContext.priorArtifacts` + `buildPrompt`, Tasks 1–2, 6 ✓
- Auto-approve tool use within task scope (§6.4) → `permissionMode: "bypassPermissions"`, Task 6 ✓
- Skills "bundled with the binary" (§6.1) → satisfied via per-phase system-prompt methodology (brainstorm decision: self-contained, no external skill dependency) — documented deviation, Task 2 ✓
- Mockable adapter / could swap a different runner (§6.2) → `AgentRunner` interface + `FakeAgentRunner` + injected `QueryFn`, Tasks 1, 5, 6 ✓
- Auth: detect both, `ANTHROPIC_API_KEY` primary, doctor validates (brainstorm decision) → Tasks 3, 8 ✓
- Model configurable, default `claude-opus-4-8` (brainstorm decision) → Task 4 ✓

**Intentionally deferred (not gaps):** the engine that *drives* phases (advance/gates/resume) is Plan 4 — it consumes `AgentRunner` (it will use `FakeAgentRunner` in tests). Persisting `PhaseResult`/events to the `Store` and streaming to the TUI is Plan 4/5. **Packaging the SDK's native `claude` binary into the `bun build --compile` single binary is OUT of scope** — Plan 3 runs the SDK via the node_modules-resolved binary; the sidecar/extract-on-startup packaging is a later release task. Per-phase tool allow-listing (vs blanket `bypassPermissions`) and `maxBudgetUsd` caps are future hardening.

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `AgentEvent`/`PhaseResult`/`PhaseContext` (Task 1) are used unchanged by `FakeAgentRunner` (5), `SdkAgentRunner` (6), and the tests. `AgentRunner.run → AsyncGenerator<AgentEvent, PhaseResult>` is identical across the interface (1), fake (5), and real adapter (6). `phaseDefinition`/`buildPrompt` (2) are consumed by the adapter (6). `detectCredentials`/`credentialEnv` (3) are consumed by the adapter (6) and doctor (8). `GroveConfig.agent.model` (4) is the value threaded into `PhaseContext.model` by the engine later. `Phase` is the Plan 1 domain type throughout.
