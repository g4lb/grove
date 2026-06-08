import type { AgentEvent } from "./events.ts";

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clip(v: string, n = 72): string {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** A short, Claude-Code-style `Tool(arg)` summary of a tool call for the live feed. */
export function describeToolUse(tool: string, input: unknown): string {
  const o = asRecord(input);
  let arg: string;
  switch (tool) {
    case "Bash":
      arg = clip(str(o.command));
      break;
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "Read":
      arg = str(o.file_path);
      break;
    case "NotebookEdit":
      arg = str(o.notebook_path);
      break;
    case "Glob":
    case "Grep":
      arg = clip(str(o.pattern));
      break;
    case "Skill":
      arg = str(o.command) || str(o.name) || str(o.skill);
      break;
    case "Task":
      arg = clip(str(o.description));
      break;
    case "WebFetch":
      arg = str(o.url);
      break;
    case "WebSearch":
      arg = clip(str(o.query));
      break;
    case "TodoWrite":
      arg = "";
      break;
    default: {
      const first = Object.values(o).find((v) => typeof v === "string" && v.trim().length > 0);
      arg = first ? clip(String(first)) : "";
    }
  }
  return arg ? `${tool}(${arg})` : tool;
}

/**
 * Render one agent event into human-readable feed lines (Claude-Code style):
 * tool calls and notices get a `· ` bullet; the agent's narration is shown as plain lines.
 */
export function renderAgentEvent(event: AgentEvent, emit: (line: string) => void): void {
  if (event.type === "token") {
    for (const raw of event.text.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (line.trim()) emit(line);
    }
  } else if (event.type === "tool_use") {
    emit(`· ${describeToolUse(event.tool, event.input)}`);
  } else if (event.type === "notice") {
    emit(`· ${event.message}`);
  }
}
