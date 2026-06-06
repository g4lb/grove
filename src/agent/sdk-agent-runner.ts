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
  /** The environment to derive credentials from and pass to the subprocess (defaults to process.env). */
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
        // Pass the full base env (so the SDK subprocess inherits PATH/HOME and can
        // launch the native binary), with the credential vars overlaid to guarantee
        // they're present.
        env: { ...this.env, ...credentialEnv(this.env) },
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
