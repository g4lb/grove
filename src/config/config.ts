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
