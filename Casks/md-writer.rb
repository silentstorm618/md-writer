cask "md-writer" do
  version "1.1.0"
  sha256 "74bf053415e3307099ed5526a2f484f740dc3f74202bd158b336c1728aaab01a"

  url "https://github.com/silentstorm618/md-writer/releases/download/v#{version}/MDWriter-#{version}.pkg"
  name "MD Writer"
  desc "原生 macOS Markdown 编辑器，可导出 HTML / PDF / Word / PNG"
  homepage "https://github.com/silentstorm618/md-writer"

  depends_on macos: :ventura

  # 用 pkg 安装时，卸载要交给 pkgutil（Homebrew 会读 receipt 的
  # Bill of Materials 来删除实际文件）
  pkg "MDWriter-#{version}.pkg"
  uninstall pkgutil: "com.mdwriter.app"

  zap trash: [
    "~/Library/Application Support/MDWriter",
  ]
end
