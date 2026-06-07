import { join } from "node:path";
import { writeFileSync } from "node:fs";

export interface BuildTarget {
  target: string;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  outfile: string;
}

export const TARGETS: BuildTarget[] = [
  { target: "bun-darwin-arm64", os: "darwin", arch: "arm64", outfile: "grove-darwin-arm64" },
  { target: "bun-darwin-x64", os: "darwin", arch: "x64", outfile: "grove-darwin-x64" },
  { target: "bun-linux-x64", os: "linux", arch: "x64", outfile: "grove-linux-x64" },
  { target: "bun-linux-arm64", os: "linux", arch: "arm64", outfile: "grove-linux-arm64" },
];

export interface BuildAllDeps {
  outDir: string;
  build: (target: string, outfile: string) => Promise<void>;
  sha256: (filePath: string) => Promise<string>;
  writeChecksums: (path: string, content: string) => void;
}

/** Build every target into outDir and write a sha256sum-format SHASUMS256.txt. Returns built filenames. */
export async function buildAll(deps: BuildAllDeps): Promise<string[]> {
  const lines: string[] = [];
  const built: string[] = [];
  for (const t of TARGETS) {
    const out = join(deps.outDir, t.outfile);
    await deps.build(t.target, out);
    const sha = await deps.sha256(out);
    lines.push(`${sha}  ${t.outfile}`);
    built.push(t.outfile);
  }
  deps.writeChecksums(join(deps.outDir, "SHASUMS256.txt"), lines.join("\n") + "\n");
  return built;
}

// Real entrypoint (not run under test).
if (import.meta.main) {
  const outDir = "dist";
  await buildAll({
    outDir,
    build: async (target, out) => {
      const proc = Bun.spawn(
        ["bun", "build", "./src/cli/index.ts", "--compile", `--target=${target}`, "--outfile", out],
        { stdout: "inherit", stderr: "inherit" },
      );
      if ((await proc.exited) !== 0) throw new Error(`build failed for ${target}`);
    },
    sha256: async (file) => {
      const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
      return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    },
    writeChecksums: (path, content) => writeFileSync(path, content),
  });
  console.log("built all targets + SHASUMS256.txt");
}
