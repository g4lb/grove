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
  if (!(await file.exists())) return DEFAULT_CONFIG;
  const parsed = (await file.json()) as Partial<GroveConfig>;
  return {
    disk: { ...DEFAULT_CONFIG.disk, ...(parsed.disk ?? {}) },
  };
}

export async function saveConfig(paths: GrovePaths, config: GroveConfig): Promise<void> {
  await Bun.write(paths.configFile, JSON.stringify(config, null, 2));
}
