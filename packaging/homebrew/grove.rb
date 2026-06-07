# Homebrew formula for grove. Lives in the g4lb/homebrew-tap repo.
# Bump `version` and the four `sha256` values on each release (the release workflow prints them).
class Grove < Formula
  desc "Orchestrates AI-driven development in isolated environments"
  homepage "https://github.com/g4lb/grove"
  version "0.1.2"

  on_macos do
    on_arm do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-darwin-arm64"
      sha256 "REPLACE_DARWIN_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-darwin-x64"
      sha256 "REPLACE_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-linux-arm64"
      sha256 "REPLACE_LINUX_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-linux-x64"
      sha256 "REPLACE_LINUX_X64_SHA256"
    end
  end

  def install
    bin.install Dir["grove-*"].first => "grove"
  end

  def caveats
    <<~EOS
      grove needs its claude runtime. Finish setup with:
        grove install-runtime
    EOS
  end

  test do
    # The release process bumps `version` to the tag and grove's VERSION together,
    # so the binary reports the formula version — assert against it, not a literal.
    assert_match version.to_s, shell_output("#{bin}/grove --version")
  end
end
