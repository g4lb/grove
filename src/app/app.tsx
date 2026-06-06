import React, { useState, useEffect, useReducer, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { TaskRunController } from "./controller.ts";

export interface AppProps {
  controller: Pick<TaskRunController, "snapshot" | "start" | "decide"> & { onChange: () => void };
}

export function App({ controller }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [input, setInput] = useState("");
  const [feedbackMode, setFeedbackMode] = useState(false);

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
    if (terminal) {
      if (char === "q" || key.return || (key.ctrl && char === "c")) exit();
      return;
    }
    if (view.state === "idle") {
      if (key.return) {
        const prose = inputRef.current.trim();
        if (prose.length > 0) {
          updateInput("");
          void controller.start(prose);
        }
      } else if (key.backspace || key.delete) {
        updateInput(inputRef.current.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        updateInput(inputRef.current + char);
      }
    } else if (view.state === "waiting_confirm") {
      if (feedbackMode) {
        if (key.return) {
          const fb = inputRef.current.trim();
          updateInput("");
          setFeedbackMode(false);
          void controller.decide({ kind: "rerun", feedback: fb.length > 0 ? fb : undefined });
        } else if (key.backspace || key.delete) {
          updateInput(inputRef.current.slice(0, -1));
        } else if (char && !key.ctrl && !key.meta) {
          updateInput(inputRef.current + char);
        }
      } else if (char === "a") {
        void controller.decide({ kind: "approve" });
      } else if (char === "s") {
        void controller.decide({ kind: "stop" });
      } else if (char === "r") {
        setFeedbackMode(true);
      }
    }
  });

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

      {terminal && <Text dimColor>press q to quit</Text>}

      {view.state === "running" && <Text dimColor>working…</Text>}

      {view.state === "waiting_confirm" && !feedbackMode && (
        <Text color="cyan">(a) approve / (r) request changes / (s) stop</Text>
      )}
      {view.state === "waiting_confirm" && feedbackMode && <Text>{"changes: "}{input}</Text>}
    </Box>
  );
}
