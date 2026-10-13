cask "md-writer" do
  version "1.0.1"
  sha256 "9744424b7f9f062fbb26c6a27ee4d8a1de042a05c83e09c027b9420a6b8b2d49"

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
