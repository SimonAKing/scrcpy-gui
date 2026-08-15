# Scrcpy GUI

[![Validate](https://github.com/SimonAKing/scrcpy-gui/actions/workflows/validate.yml/badge.svg)](https://github.com/SimonAKing/scrcpy-gui/actions/workflows/validate.yml)
[![GitHub release](https://img.shields.io/github/v/release/SimonAKing/scrcpy-gui?include_prereleases)](https://github.com/SimonAKing/scrcpy-gui/releases)
[![GPL-3.0](https://img.shields.io/github/license/SimonAKing/scrcpy-gui)](LICENSE)

A modern, secure desktop interface for [scrcpy](https://github.com/Genymobile/scrcpy). Connect Android devices over USB or wireless debugging, launch several mirrors, record sessions, and configure current scrcpy 4.x options without assembling command lines by hand.

> Version 2.0 is a ground-up modernization and is currently in beta. Please report regressions with the Logs tab output and your scrcpy version.

## Highlights

- USB discovery plus Android 11+ wireless pairing (`adb pair`) and connection
- Multi-device launch with duplicate-process protection
- scrcpy 4.x video, audio, keyboard, shortcut, recording, window, crop, and codec options
- Correct startup state: errors from stderr are shown instead of reporting false success
- Optional popup muting with a persistent process log
- English, Simplified Chinese, Traditional Chinese, and Russian UI with system-language detection
- Electron context isolation, sandboxed renderer, restricted IPC, and no shell command execution
- Automated tests and release builds for macOS, Windows, and Linux

## Requirements

- [scrcpy 4.x](https://github.com/Genymobile/scrcpy/releases)
- `adb` from Android platform-tools, or an official scrcpy bundle that contains it
- Android debugging enabled on the target device

Scrcpy GUI does not modify or redistribute scrcpy. On first launch, choose the `scrcpy` executable, or make both `scrcpy` and `adb` available on `PATH`.

## Install

Download the package for your operating system from [GitHub Releases](https://github.com/SimonAKing/scrcpy-gui/releases).

The beta artifacts are not currently notarized or code-signed by the release workflow. Your operating system may ask you to confirm that you trust the downloaded application.

## Wireless debugging

For Android 11 and later:

1. Enable **Developer options → Wireless debugging**.
2. Choose **Pair device with pairing code** on the phone.
3. Enter the displayed pairing address and six-digit code in Scrcpy GUI and select **Pair**.
4. Enter the separate wireless-debugging connection address and select **Connect**.

Legacy devices may connect directly to `host:5555` after enabling ADB over TCP/IP.

## Development

Node.js 22 or later is recommended.

```bash
npm ci
npm test
npm run dev
```

Useful commands:

```bash
npm run typecheck
npm run build
npm run build:dir
```

The app uses Electron, Vue 3, TypeScript, Vite, and electron-builder. Main-process commands live in `src/main/`, the sandboxed renderer in `src/renderer/`, and pure scrcpy argument/address logic is covered in `tests/`.

The Russian translation was originally contributed by [@dEN5-tech](https://github.com/dEN5-tech) in [#69](https://github.com/SimonAKing/scrcpy-gui/pull/69) and migrated to the 2.0 interface.

## Troubleshooting

- If no device appears, run `adb devices -l` and authorize the computer on the phone.
- If scrcpy closes immediately, open the **Logs** tab and include its stderr output in your issue.
- Width and height for crop/window sizing must both be zero or both be positive.
- Keep **Shortcut modifier** on **System default** unless you intentionally want scrcpy to capture Ctrl-based shortcuts.

## License

Scrcpy GUI is available under [GPL-3.0](LICENSE). scrcpy is a separate project distributed under its own license.
