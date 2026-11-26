# Agy Shift

Windows 轻量级 **Antigravity** 账号切换与配额管理工具。

A lightweight **Antigravity** account switcher and quota tracker for Windows. Switch accounts across the desktop app, IDE, and CLI, monitor usage, and choose which executable each client launches.

[下载 Windows x64 安装包 · Download for Windows x64](https://github.com/KeS1Ke/agy-shift/releases/latest)

> 本项目基于 [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools) 进行 Fork 与精简裁剪，剥离了其他平台与多开实例模块，仅保留 Windows 下的 Antigravity 核心能力，并依据原项目许可证保留对 `jlcodes99/cockpit-tools` 的 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans) 署名与开源条款。
>
> Based on [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools), adapted for Antigravity on Windows under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

---

## 核心功能

- **账号切换**。支持 Antigravity 桌面端、IDE 和 CLI。每张账号卡片可以选择仅切号或切号并启动。
- **自定义启动路径**。在右下角设置中分别指定三个客户端的可执行文件，也可以恢复自动探测。
- **额度查看**。账号卡片区分 PLUS、PRO、ULTRA 5X 和 ULTRA 20X，展示 Gemini、Claude 的 5 小时及周额度、重置倒计时、最近切换时间，并支持单账号刷新。
- **应用内更新**。从标题栏检查新版本，并下载经更新公钥验证的安装包。
- **添加账号**。无需配置 Google OAuth：在官方 Antigravity 桌面端或 IDE 登录后，直接从本机读取当前登录态导入，也支持旧版工具数据和 JSON 批量迁移。
- **删除账号**。在账号卡片中确认后，可移除该账号及 Agy Shift 保存的本地登录凭据。
- **托盘常驻**。收进托盘时释放主窗口和账号列表缓存。点击托盘图标可重新打开窗口。

### 免 OAuth 本机接管说明 / Zero-OAuth local account import

Agy Shift 默认**不需要配置任何 Google OAuth 凭据**：

- 在官方 Antigravity 桌面端 / IDE 正常登录账号后，点击 **「+ 添加账号 → 本机导入」** 即可直接读取本机已有的登录凭据与配额，并在多账号之间一键切换。
- 当某个账号的本地访问令牌过期时，切回该账号并打开官方 Antigravity 客户端自动续期后，Agy Shift 会自动从本机同步最新令牌并刷新配额。
- 所有账号和凭据仅保留在用户个人电脑本地，不经过任何外部中转服务。

Agy Shift works **without any Google OAuth client configuration**:

- Sign in using the official Antigravity desktop app or IDE, then click **+ Add Account → Local Import** to read the local login state, sync quota, and switch between accounts.
- If a cached local access token expires, switch to that account and open Antigravity so the official client renews it locally; Agy Shift automatically picks up the refreshed local token on the next quota check.
- All account data and credentials remain strictly on the user's own computer.

---

## 数据目录与隔离策略

Agy Shift 默认与原版 Cockpit Tools 数据目录隔离，避免首次试用时互相覆盖：

- **开发模式（Debug / `AGY_SHIFT_PROFILE=dev`）**：默认使用 `~/.agy_shift_dev`，偏好文件为 `~/.agy_shift_dev-data-root.json`。
- **正式版（Release）**：默认使用 `~/.agy_shift`，偏好文件为 `~/.agy_shift-data-root.json`。
- **环境变量覆盖**：可通过 `AGY_SHIFT_DATA_DIR`（或兼容变量 `COCKPIT_TOOLS_DATA_DIR`）显式指定数据目录。

---

## 构建与自动更新说明

### 开发与打包

前置环境为 Node.js 18+、npm 9+、Rust 和 Inno Setup 7。`scripts/tauri.cjs` 支持 GNU 和 MSVC 工具链。

```bash
# 安装前端依赖
npm install

# 前端类型检查
npm run typecheck

# 启动开发模式
npm run tauri:dev

# 构建 NSIS 安装包
npm run build:nsis

# 仅编译单文件 Release 可执行文件 (target/release/agy-shift.exe)
npm run build:exe

# 生成 Inno Setup 安装包、更新签名和清单
npm run build:inno

# 运行 Rust 单元测试
npm run test:rust
```

### 自动更新配置

Inno 安装版从 `installer/tauri.inno.json` 指定的 GitHub Release 清单检查更新。应用使用内置公钥校验安装包及其版本，验签通过后启动 Inno 安装器，完成安装后启动新版本。更新窗口也可以直接打开 GitHub 发布页。

`npm run build:inno` 在 `target/release/bundle/inno/` 生成安装包 `.exe`、Tauri 更新签名 `.exe.sig` 和 `latest-windows-inno.json`。发布时将同一次构建的三个文件上传到与 `package.json` 版本对应的 `v<版本>` GitHub Release。更新要求新版本号高于已安装版本。`npm run build:inno:only` 可重新打包此前由 Inno 构建流程编译的程序。

公钥保存在 `src-tauri/tauri.conf.json`。本机构建从 `%LOCALAPPDATA%\AgyShiftSigning` 读取 Windows 当前用户加密的私钥。后续更新需要沿用同一密钥。更新签名用于应用内验签，Windows Authenticode 签名需要受信任的代码签名证书，并须在生成 `.exe.sig` 前完成。

---

## 许可证

本项目遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名-非商业性使用-相同方式共享 4.0 国际）协议，派生自 [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools)。

- **允许**：在保留原始署名（`jlcodes99/cockpit-tools`）及相同协议的前提下，用于个人学习、研究与非商业用途的修改与分发。
- **禁止**：任何未获原项目作者书面授权的商业使用。
