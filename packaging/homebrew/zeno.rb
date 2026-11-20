# Cask do tap próprio (chmenegatti/homebrew-tap): brew install --cask chmenegatti/tap/zeno
cask "zeno" do
  version "1.1.0"
  sha256 "611c0a328d7ce9d908133f7af7bc1f14c41c5dce9e51eeac045d399e431e3c84"

  url "https://github.com/chmenegatti/zeno/releases/download/v#{version}/Zeno-#{version}-macos-universal.dmg"
  name "Zeno"
  desc "Tab-less, local-first API client (REST, GraphQL, gRPC, WebSocket)"
  homepage "https://www.cesarmenegatti.com/zeno/"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Zeno.app"

  zap trash: "~/.local/share/zeno"

  caveats <<~EOS
    Zeno is not notarized by Apple yet. On first launch, open
    System Settings › Privacy & Security and click "Open Anyway".
  EOS
end
