<div align="center">

# Agy Shift

A lightweight **Antigravity** account switcher and quota tracker for Windows. All accounts and credentials stay strictly on your local computer with zero external relay servers.

<p>
  <a href="README.md"><img src="https://img.shields.io/badge/语言-简体中文-374151?style=for-the-badge" alt="简体中文" /></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/Language-English-0891b2?style=for-the-badge" alt="English" /></a>
</p>

<p>
  <a href="https://github.com/KeS1Ke/agy-shift/releases/latest"><img src="https://img.shields.io/github/v/release/KeS1Ke/agy-shift?label=Release&color=0891b2" alt="Latest Release" /></a>
  <a href="https://github.com/KeS1Ke/agy-shift/releases/latest"><img src="https://img.shields.io/badge/Platform-Windows%20x64-2563eb" alt="Platform" /></a>
  <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/"><img src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-6b7280" alt="License" /></a>
</p>

**[Download Installer for Windows x64](https://github.com/KeS1Ke/agy-shift/releases/latest)**

</div>

> **Upgrading from v0.1.6 or earlier**. The update signing key has changed. Install the latest release manually once to resume in-app updates for future releases.

![Agy Shift UI Preview (Anonymized Demo Data)](docs/preview.png)

> Forked and streamlined from [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools), focused specifically on Antigravity on Windows, retaining upstream attribution under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

---

## Features

- **Direct Client & Account Switching**: Switch directly between `Desktop`, `CLI`, and `IDE` from the top toolbar. Each account card provides dedicated **Switch Only** (`仅切号`) and **Switch & Launch** (`切号启动`) buttons.
- **Active Account Detection**: Reads the local sign-in state for Desktop, CLI, or IDE and updates the active account badge. If Auto-switch is enabled, it evaluates quotas for the detected account.
- **OAuth Token Renewal**: GitHub installers come with OAuth configured and can renew saved `refresh_token`s in the background.
- **Background Quota Refresh**: At the interval configured under **Settings → Quota auto-refresh**, Agy Shift renews tokens and pulls Gemini / Claude quotas per account, including while the app is in the tray. If you enable **Auto-switch**, refresh results can trigger its rules.
- **Flexible Account Import**: Google OAuth authorization, local session import, legacy tool migration, and batch JSON import are all supported; local imports sync quota immediately.
- **1-Decimal Quota Tracking**: Displays account tiers (`PLUS`, `PRO`, `ULTRA 5X`, `ULTRA 20X`), 5-hour and weekly quotas for Gemini and Claude with 1-decimal percentage precision, reset countdowns, last switch timestamps, plus per-account refresh and refresh-all.
- **Auto Update & Notification Badge**: Toggle **Auto check updates** and **Auto download updates** in Basic Settings. When a newer release is available, a pale-cyan badge appears next to the bottom-right Settings button and verifies packages against the embedded public key before installing.
- **Custom Launch Paths**: Configure custom executable paths independently for the Desktop app, IDE, and CLI, or restore auto-detection at any time.
- **Instant Tray Reopen**: Minimizing to the system tray hides the main window in low-memory mode so clicking the tray icon restores the UI instantly without white-screen flashing.
- **Local-First Privacy**: All accounts, tokens, and quota caches remain exclusively on your own machine—nothing is sent to developer or third-party relay servers.

---

## OAuth & Token Renewal

The GitHub installer comes with Google OAuth configured:

1. Sign in to your account inside the official Antigravity desktop app or IDE.
2. Open Agy Shift and click **+ Add Account → Local Import** (Google OAuth authorization and JSON import work too) to add the local credentials and quota to your account pool.
3. When a cached access token expires, Agy Shift renews it in the background with the saved `refresh_token` and refreshes the quota — **no account switching or official client launch required**.
4. For source builds, set `AGY_SHIFT_GOOGLE_OAUTH_CLIENT_ID` and `AGY_SHIFT_GOOGLE_OAUTH_CLIENT_SECRET` before building or launching. Saved tokens with a known client continue to renew through that client.

---

## Data Directory & Isolation

Agy Shift isolates its data directory from upstream Cockpit Tools by default so trying it out never overwrites existing data:

- **Development (`Debug` / `AGY_SHIFT_PROFILE=dev`)**: defaults to `~/.agy_shift_dev` (preference file: `~/.agy_shift_dev-data-root.json`).
- **Release**: defaults to `~/.agy_shift` (preference file: `~/.agy_shift-data-root.json`).
- **Environment override**: set `AGY_SHIFT_DATA_DIR` (or compatible `COCKPIT_TOOLS_DATA_DIR`) to use a custom directory.

---

## Build from Source

Prerequisites: Node.js 18+, npm 9+, and a Rust toolchain.

```bash
# Install frontend dependencies
npm install

# Run TypeScript typecheck
npm run typecheck

# Start Tauri dev mode
npm run tauri:dev

# Build standalone release executable
npm run build:exe

# Build installer
npm run build:nsis

# Run Rust unit tests
npm run test:rust
```

> In-app updates fetch the release manifest from GitHub Releases and verify package signatures against the embedded public key. You can also open the GitHub Releases page directly from the update dialog to download manually.

---

## License

Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (Attribution-NonCommercial-ShareAlike 4.0 International), derived from [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools).

- **Allowed**: Personal, educational, research, and non-commercial modification and redistribution with attribution to `jlcodes99/cockpit-tools` under the same license.
- **Not allowed**: Commercial use without explicit written permission from the upstream author.
