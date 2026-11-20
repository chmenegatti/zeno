# Cask do tap próprio (chmenegatti/homebrew-tap): brew install --cask chmenegatti/tap/zeno
cask "zeno" do
  version "1.2.0"
  sha256 "af5ffe61e485295c5ed197be16fb1275a53e4af09111bab0be7c5bbc9e54e1ef"

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
