#!/bin/sh
# grove installer — downloads the grove binary, verifies it, and fetches the claude runtime.
set -eu

REPO="g4lb/grove"
GROVE_HOME="${GROVE_HOME:-$HOME/.grove}"
BIN_DIR="$GROVE_HOME/bin"
VERSION="${GROVE_VERSION:-latest}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

uname_s="${GROVE_FORCE_OS:-$(uname -s)}"
uname_m="${GROVE_FORCE_ARCH:-$(uname -m)}"

case "$uname_s" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) echo "grove: unsupported OS: $uname_s (supported: macOS, Linux)"; exit 1 ;;
esac
case "$uname_m" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) echo "grove: unsupported architecture: $uname_m"; exit 1 ;;
esac

ASSET="grove-$OS-$ARCH"
if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
BIN_URL="$BASE/$ASSET"
SUM_URL="$BASE/SHASUMS256.txt"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "grove: would install $ASSET"
  echo "  binary:    $BIN_URL"
  echo "  checksums: $SUM_URL"
  echo "  into:      $BIN_DIR/grove"
  exit 0
fi

echo "grove: downloading $ASSET (~65 MB)…"
mkdir -p "$BIN_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fL --progress-bar "$BIN_URL" -o "$tmp/grove"
curl -fsSL "$SUM_URL" -o "$tmp/SHASUMS256.txt"
echo "grove: verifying checksum…"

expected="$(grep " $ASSET\$" "$tmp/SHASUMS256.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then echo "grove: no checksum found for $ASSET" >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/grove" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/grove" | awk '{print $1}')"
else
  echo "grove: no SHA-256 tool found (need sha256sum or shasum) to verify the download" >&2
  exit 1
fi
if [ "$expected" != "$actual" ]; then
  echo "grove: checksum mismatch for $ASSET" >&2
  exit 1
fi

chmod +x "$tmp/grove"
mv "$tmp/grove" "$BIN_DIR/grove"
echo "grove: installed to $BIN_DIR/grove"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    # Honor $GROVE_HOME via $BIN_DIR; keep $PATH literal in the rc file.
    line="export PATH=\"$BIN_DIR:\$PATH\""
    case "${SHELL:-}" in
      */zsh) rc="$HOME/.zshrc" ;;
      */bash) rc="$HOME/.bashrc" ;;
      *) rc="$HOME/.profile" ;;
    esac
    if ! grep -qsF "$BIN_DIR" "$rc" 2>/dev/null; then
      printf '\n# grove\n%s\n' "$line" >>"$rc"
      echo "grove: added $BIN_DIR to your PATH in $rc"
    fi
    echo "grove: restart your terminal, or run now:  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo "grove: fetching the claude runtime (~225 MB, this can take a minute)…"
"$BIN_DIR/grove" install-runtime || echo "grove: run 'grove install-runtime' later to finish setup"

echo "grove: done. Run 'grove' to start."
