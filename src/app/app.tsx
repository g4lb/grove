import React, { useState, useEffect, useReducer, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { TaskRunController } from "./controller.ts";

export interface AppProps {
  controller: Pick<
    TaskRunController,
    "snapshot" | "start" | "submit" | "selectUp" | "selectDown" | "openSelected" | "backToPrompt"
  > & { onChange: () => void };
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
  const terminal = view.state === "done" || view.state === "blocked" || view.state === "stopped";

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
        <Text color="green">grove — tasks</Text>
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
      <Text color="green">grove</Text>

      {view.state === "idle" && <Text>{"› "}{input || "what do you want to work on?"}</Text>}

      {view.feed.map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}

      {view.message.length > 0 && <Text>{view.message}</Text>}

      {view.state === "running" && <Text dimColor>working…</Text>}

      {terminal && <Text dimColor>enter: new prompt · q: quit</Text>}

      {view.viewing && <Text dimColor>esc: back</Text>}
    </Box>
  );
}
