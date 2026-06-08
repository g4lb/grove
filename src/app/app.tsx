import React, { useState, useEffect, useReducer, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { TaskRunController } from "./controller.ts";
import { formatStats } from "../agent/agent-feed.ts";

export interface AppProps {
  controller: Pick<
    TaskRunController,
    "snapshot" | "start" | "submit" | "selectUp" | "selectDown" | "openSelected" | "backToPrompt"
  > & { onChange: () => void };
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** One feed line, highlighted Claude-Code style: actions (`· …`) stand out, narration is dimmed. */
function FeedLine({ line }: { line: string }): React.ReactElement {
  if (line.startsWith("· ")) {
    return (
      <Text>
        <Text color="cyan">· </Text>
        {line.slice(2)}
      </Text>
    );
  }
  return <Text dimColor>{line}</Text>;
}

export function App({ controller }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [input, setInput] = useState("");

  // Ref mirror of the input so synchronous key bursts (e.g. text then Enter)
  // always read the latest value, not the value captured at render time.
  const inputRef = useRef("");
  const updateInput = (next: string) => {
    inputRef.current = next;
    setInput(next);
  };

  useEffect(() => {
    controller.onChange = () => forceRender();
    return () => {
      controller.onChange = () => {};
    };
  }, [controller]);

  const view = controller.snapshot();
  const running = view.state === "running";
  const terminal = view.state === "done" || view.state === "blocked" || view.state === "stopped";

  // Live spinner + elapsed clock while a session runs.
  const startRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const frameRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % SPINNER.length;
      forceRender();
    }, 120);
    return () => clearInterval(id);
  }, [running]);

  if (running) {
    if (startRef.current === null) startRef.current = Date.now();
    elapsedRef.current = Math.floor((Date.now() - startRef.current) / 1000);
  } else if (view.state === "idle") {
    startRef.current = null;
    elapsedRef.current = 0;
  }
  const elapsed = elapsedRef.current;
  const statusTail = (withElapsed: boolean): string => {
    const s = formatStats(view.stats, withElapsed ? elapsed : undefined);
    return s ? ` · ${s}` : "";
  };

  useInput((char, key) => {
    if (view.mode === "list") {
      if (key.upArrow) controller.selectUp();
      else if (key.downArrow) controller.selectDown();
      else if (key.return || char === "o") controller.openSelected();
      else if (key.escape) controller.backToPrompt();
      return;
    }
    if (view.viewing && key.escape) {
      controller.backToPrompt();
      return;
    }
    if (terminal) {
      if (key.return) controller.backToPrompt();
      else if (char === "q" || (key.ctrl && char === "c")) exit();
      return;
    }
    if (view.state === "idle") {
      if (key.return) {
        const prose = inputRef.current.trim();
        if (prose.length > 0) {
          updateInput("");
          void controller.submit(prose);
        }
      } else if (key.backspace || key.delete) {
        updateInput(inputRef.current.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        updateInput(inputRef.current + char);
      }
    }
  });

  if (view.mode === "list") {
    return (
      <Box flexDirection="column">
        <Text color="green" bold>
          grove — tasks
        </Text>
        {view.tasks.length === 0 && <Text dimColor>no tasks yet</Text>}
        {view.tasks.map((t, i) => (
          <Text key={t.id} color={i === view.selected ? "cyan" : undefined}>
            {i === view.selected ? "› " : "  "}
            {t.status.padEnd(10)} {t.kind.padEnd(6)} {t.title}
          </Text>
        ))}
        <Text dimColor>↑/↓ select · enter/o open · esc back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green" bold>
        grove
      </Text>

      {view.state === "idle" &&
        (input ? (
          <Text>
            {"› "}
            <Text color="cyan">{input}</Text>
          </Text>
        ) : (
          <Text>
            {"› "}
            <Text dimColor>what do you want to work on?</Text>
          </Text>
        ))}

      {view.prompt.length > 0 && view.state !== "idle" && (
        <Text>
          {"› "}
          <Text color="cyan" bold>
            {view.prompt}
          </Text>
        </Text>
      )}

      {view.feed.map((line, i) => (
        <FeedLine key={i} line={line} />
      ))}

      {running && (
        <Text color="magenta">
          {SPINNER[frameRef.current]} working
          <Text dimColor>{statusTail(true)} · esc to interrupt</Text>
        </Text>
      )}

      {terminal && view.message.length > 0 && (
        <Text>
          <Text color={view.state === "done" ? "green" : view.state === "blocked" ? "red" : "yellow"}>
            {view.state === "done" ? "✓ " : view.state === "blocked" ? "✗ " : "■ "}
          </Text>
          {view.message}
          <Text dimColor>{statusTail(true)}</Text>
        </Text>
      )}

      {terminal && <Text dimColor>enter: new prompt · q: quit</Text>}

      {view.viewing && <Text dimColor>esc: back</Text>}
    </Box>
  );
}
