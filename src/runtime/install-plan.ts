const REPO = "g4lb/grove";

export interface InstallPlan {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  asset: string;
  binaryUrl: string;
  checksumsUrl: string;
}

/** Map `uname -s`/`uname -m` to a release asset + download URLs, or null if unsupported. */
export function planInstall(unameS: string, unameM: string, version: string): InstallPlan | null {
  const os = unameS === "Darwin" ? "darwin" : unameS === "Linux" ? "linux" : null;
  const arch =
    unameM === "arm64" || unameM === "aarch64" ? "arm64" : unameM === "x86_64" || unameM === "amd64" ? "x64" : null;
  if (!os || !arch) return null;

  const asset = `grove-${os}-${arch}`;
  const base =
    version === "latest"
      ? `https://github.com/${REPO}/releases/latest/download`
      : `https://github.com/${REPO}/releases/download/${version}`;
  return { os, arch, asset, binaryUrl: `${base}/${asset}`, checksumsUrl: `${base}/SHASUMS256.txt` };
}
