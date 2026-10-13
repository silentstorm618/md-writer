# 签名与公证（Notarization）指南

> **当前状态**：项目未加入 Apple Developer Program，产物**未签名未公证**。
> 分发靠 Homebrew Cask 绕过 Gatekeeper。本文件记录将来补齐签名公证的完整步骤——
> 代码和脚本已经全部就位，补一张证书即可原地升级，不需要改任何代码。

---

## 一、为什么需要公证

macOS 10.15+ 对**从网络下载**的 App 一律加 `com.apple.quarantine` 标记，
打开时 Gatekeeper 会联网核查。没有有效签名和票据，用户看到：

> 「MD Writer.app 已损坏，无法打开。你应该将它移到废纸篓。」

文件一点没坏，这是 Gatekeeper 的误导文案。

需要三件事，缺一不可：

| 环节 | 命令 | 作用 |
|---|---|---|
| 1. Developer ID 签名 | `codesign --options runtime --timestamp` | 证明身份 + 开启 Hardened Runtime |
| 2. 公证 | `xcrun notarytool submit` | Apple 云端扫描恶意代码，签发票据 |
| 3. 钉票 | `xcrun stapler staple` | 票据嵌进产物，**断网**也能通过检查 |

第 3 步最常被漏——只公证不 staple，用户断网打开依然被拦。

---

## 二、准备证书

1. 加入 [Apple Developer Program](https://developer.apple.com/programs/)（$99/年）
2. Xcode → Settings → Accounts → 选中团队 → Manage Certificates → `+`
   需要下载**两张**：
   - **Developer ID Application** —— 签 `.app` / `.dmg`
   - **Developer ID Installer** —— 签 `.pkg`（`productsign` 只认这张）

验证钥匙串里已经有了：

```bash
security find-identity -v -p codesigning
```

应能看到两行 `Developer ID Application: ...` 和 `Developer ID Installer: ...`。

---

## 三、配置公证凭据（二选一）

### 方式 A：keychain profile（本地发布）

1. 到 [appleid.apple.com](https://appleid.apple.com) 生成 **App 专用密码**
2. 存入钥匙串：

```bash
xcrun notarytool store-credentials "MDWriter" \
  --apple-id you@example.com \
  --team-id TEAMID \
  --password xxxx-xxxx-xxxx-xxxx
```

3. 使用：

```bash
export NOTARY_PROFILE=MDWriter
make notarize
```

### 方式 B：App Store Connect API Key（CI 推荐）

到 [App Store Connect → 用户和访问 → 密钥](https://appstoreconnect.apple.com/access/api)
创建密钥（需要 `Developer` 角色），下载 `.p8` 文件（**只能下载一次**）。

```bash
export NOTARY_KEY_ID=XXXXXXXXXX
export NOTARY_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export NOTARY_KEY_PATH=~/AuthKey_XXXXXXXXXX.p8
```

`notarize.py` 会优先用 `NOTARY_PROFILE`，没配才退到 API Key 三件套。

---

## 四、执行

```bash
make notarize          # 等价于 python3 build/notarize.py --dmg --pkg
```

脚本会自动：

1. 探测钥匙串里的 Developer ID Application / Installer 证书
2. `codesign --force --options runtime --timestamp` + `entitlements.plist`
3. 生成 dmg / pkg，分别用对应证书签名
4. `notarytool submit --wait` 逐个提交（阻塞到 Apple 出结果）
5. `stapler staple` 钉票
6. `spctl --assess` + `stapler validate` 验证

只签名不公证（比如先本地验一下）：

```bash
make sign
```

只体检当前产物：

```bash
make verify-sign
```

---

## 五、验证成功的样子

```bash
$ spctl --assess --type exec --verbose=4 native/MDWriter.app
native/MDWriter.app: accepted
source=Notarized Developer ID

$ xcrun stapler validate native/MDWriter.app
Processed native/MDWriter.app with error: ...
# 若显示 "The validate action worked!" 即为通过

$ codesign -dv --verbose=4 native/MDWriter.app 2>&1 | grep -E "Timestamp|TeamIdentifier"
Timestamp=2026-10-13 ...
TeamIdentifier=XXXXXXXXXX
```

三个都过，就可以对外分发了。

---

## 六、常见被拒原因

| Apple 返回的错误 | 原因 | 修法 |
|---|---|---|
| `The signature does not include a secure timestamp` | 漏了 `--timestamp` | `codesign` 加 `--timestamp` |
| `The executable does not have the hardened runtime enabled` | 漏了 `--options runtime` | 加上 |
| `The entitlement get-task-allow is not permitted` | 混入了 debug entitlement | 从 `entitlements.plist` 删掉 |
| `The binary is not signed with a valid Developer ID certificate` | 用了 ad-hoc 或 Apple Development | 换成 Developer ID |
| `Code cannot be loaded because it is missing library validation` | 加载了未签名 dylib | 加 `disable-library-validation`（本项目不需要） |

公证被拒时，`notarize.py` 会自动调 `notarytool log <id>` 拉出 Apple 的问题清单。

---

## 七、CI 配置

在仓库 Settings → Secrets 里填：

| Secret | 内容 |
|---|---|
| `MACOS_CERTIFICATE` | Developer ID Application + Installer 的 P12，base64 编码 |
| `MACOS_CERTIFICATE_PASSWORD` | P12 导出密码 |
| `KEYCHAIN_PASSWORD` | 临时钥匙串密码（任意字符串） |
| `NOTARY_KEY_ID` | App Store Connect API Key ID |
| `NOTARY_ISSUER` | Issuer UUID |
| `NOTARY_KEY_P8` | `.p8` 文件**全文**（含 `-----BEGIN PRIVATE KEY-----`） |
| `NOTARY_TEAM_ID` | 团队 ID |
| `TAP_GITHUB_TOKEN` | 有 tap 仓库写权限的 PAT |

生成 P12 的 base64：

```bash
# 钥匙串访问 → 我的证书 → 右键导出 .p12
base64 -i Certificates.p12 | pbcopy
```

填好之后 push tag 即自动签名公证：

```bash
git tag v1.0.1 && git push origin v1.0.1
```

**不填也能跑**——workflow 里的签名步骤是条件执行的，缺 secrets 时
自动降级为「只生成未签名产物」。

---

## 八、关于「能不能不花钱」

不能。Apple 没有提供免费的 Developer ID 替代方案：

- 免费 Apple ID 只能签 **Apple Development** 证书，仅供本地调试
- ad-hoc 签名（`--sign -`）只保证完整性，不证明身份，拿不到票据
- 自签名证书 Gatekeeper 不认

不花钱的唯一可行路径是**绕开 quarantine**，即当前采用的 Homebrew Cask 方案
（安装时自动清除 `com.apple.quarantine`）。
