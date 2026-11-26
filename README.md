# Agy Shift

Windows 轻量级 **Antigravity** 账号切换与配额管理工具。所有账号与登录凭据均仅保存在用户本机，不经过任何外部中转服务。

A lightweight **Antigravity** account switcher and quota tracker for Windows. Switch accounts across the desktop app, IDE, and CLI, monitor quota with 1-decimal precision, and keep all data strictly on your local computer.

[![Latest Release](https://img.shields.io/github/v/release/KeS1Ke/agy-shift?label=Release&color=0891b2)](https://github.com/KeS1Ke/agy-shift/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-2563eb)](https://github.com/KeS1Ke/agy-shift/releases/latest)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-6b7280)](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)

[下载 Windows x64 安装包 · Download for Windows x64](https://github.com/KeS1Ke/agy-shift/releases/latest)

![Agy Shift 界面预览（示例脱敏数据）](docs/preview.png)

> 本项目基于 [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools) 进行 Fork 与精简裁剪，剥离了其他平台与多开实例模块，仅保留 Windows 下的 Antigravity 核心能力，并依据原项目许可证保留对 `jlcodes99/cockpit-tools` 的 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans) 署名与开源条款。
>
> Based on [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools), adapted for Antigravity on Windows under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

---

## 核心功能

- **一键切换客户端与账号**。顶部工具栏直接切换 `Desktop`、`CLI`、`IDE` 目标客户端；每张账号卡片提供独立的 **「仅切号」** 与 **「切号启动」** 按钮，一步到位。
- **免 OAuth 本机导入**。无需配置任何 Google OAuth 客户端凭据，在官方 Antigravity 桌面端或 IDE 登录后，点击「+ 添加账号 → 本机导入」即可直接读取本机登录态，也支持旧版工具数据和 JSON 批量迁移。
- **高精度额度查看**。账号卡片区分 `PLUS`、`PRO`、`ULTRA 5X` 和 `ULTRA 20X`，展示 Gemini 与 Claude 的 5 小时及每周剩余额度（保留一位百分比小数）、重置倒计时、最近切换时间，并支持单账号刷新。
- **自动更新与提示**。在右下角「基础设置」中可选开启 **「自动检测更新」** 与 **「自动下载更新包」**；发现新版本时，右下角「设置」旁会以淡青色方框显示最新版本号，点击即可经更新公钥验签后直接安装升级。
- **自定义启动路径**。在「基础设置」中可分别为桌面端、IDE 和 CLI 指定可执行文件路径，也可随时恢复自动探测。
- **托盘常驻秒开**。收进系统托盘时隐藏主窗口并切入低内存模式，点击托盘图标可秒开恢复界面且无白屏闪烁。
- **隐私与本地安全**。所有账号、Token 与配额缓存均只保存在用户自己的电脑本地，不向开发者或任何第三方中转服务器上传数据。

---

## 免 OAuth 本机接管说明 / Zero-OAuth Local Import

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
