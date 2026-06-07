import { query as realQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunner } from "./agent-runner.ts";
import type { AgentEvent, SessionContext, SessionResult } from "./events.ts";
import { buildSessionPrompt, AUTONOMY_APPEND } from "./session-prompt.ts";
import { credentialEnv, scopedAgentEnv } from "./credentials.ts";

/** The shape of the SDK's query() that we depend on (injected for testability). */
export type QueryFn = typeof realQuery;

export interface SdkAgentRunnerOptions {
  /** Defaults to the real SDK query(); tests inject a fake. */
  queryFn?: QueryFn;
  /** The environment to derive credentials from and pass to the subprocess (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Absolute path to the native `claude` binary; null lets the SDK self-resolve (dev). */
  claudePath?: string | null;
}

export class SdkAgentRunner implements AgentRunner {
  private queryFn: QueryFn;
  private env: Record<string, string | undefined>;
  private claudePath: string | null;

  constructor(opts: SdkAgentRunnerOptions = {}) {
    this.queryFn = opts.queryFn ?? realQuery;
    this.env = opts.env ?? process.env;
    this.claudePath = opts.claudePath ?? null;
  }

  async *run(ctx: SessionContext): AsyncGenerator<AgentEvent, SessionResult> {
    let sessionId: string | null = null;
    let summary = "";
    let costUsd = 0;
    let success = false;

    try {
      const stream = this.queryFn({
        prompt: buildSessionPrompt(ctx),
        options: {
          systemPrompt: { type: "preset", preset: "claude_code", append: AUTONOMY_APPEND },
          cwd: ctx.worktreePath,
          model: ctx.model,
          maxTurns: 200,
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          plugins: [{ type: "local", path: ctx.superpowersPath }],
          ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
          // Base env scoped to drop unrelated cloud/CI secrets (the superpowers plugin runs
          // with bypassPermissions) while keeping PATH/HOME/project vars so the subprocess can
          // launch the native binary, with the Anthropic credential vars overlaid to guarantee
          // presence.
          env: { ...scopedAgentEnv(this.env), ...credentialEnv(this.env) },
        },
      } as Parameters<QueryFn>[0]);

      for await (const m of stream as AsyncIterable<any>) {
        if (m.type === "system" && m.subtype === "init") {
          sessionId = m.session_id ?? null;
          yield { type: "notice", message: "session started" };
        } else if (m.type === "stream_event") {
          const ev = m.event;
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            yield { type: "token", text: ev.delta.text };
          } else if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
            yield { type: "tool_use", tool: ev.content_block.name, input: ev.content_block.input ?? {} };
          }
        } else if (m.type === "result") {
          success = m.subtype === "success";
          summary = m.result ?? m.subtype ?? "";
          costUsd = m.total_cost_usd ?? 0;
        }
      }
    } catch (err) {
      // A thrown query()/stream error (auth failure, network drop, subprocess spawn
      // failure) becomes a failed session rather than escaping as an unhandled rejection.
      return {
        success: false,
        summary: `session error: ${err instanceof Error ? err.message : String(err)}`,
        costUsd,
        sessionId,
      };
    }

    return { success, summary, costUsd, sessionId };
  }
}
