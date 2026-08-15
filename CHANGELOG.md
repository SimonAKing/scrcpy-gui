# Changelog

## 2.0.0-beta.1

This release restarts active development with a ground-up Electron 43, Vue 3, TypeScript, and Vite architecture.

### Added

- Android 11+ wireless pairing and wireless connect/disconnect flows
- Multi-device launch with per-device lifecycle tracking and duplicate protection
- Persistent stdout/stderr log with optional popup muting
- Optional minimize-to-tray behavior (#89)
- Current scrcpy video codecs, audio forwarding, keyboard modes, recording-only mode, geometry, and safe extra arguments
- English, Simplified Chinese, Traditional Chinese, and Russian locale selection with system-language detection; Russian translation migrated from #69 by @dEN5-tech
- Cross-platform validation and tag-driven release workflows

### Fixed

- Stop forcing Ctrl as scrcpy's shortcut modifier, fixing normal Ctrl+X/C/V behavior (#158, #112)
- Accept valid ports from 1 through 65535 instead of exactly four digits (#118, #115)
- Replace removed scrcpy 1.x flags with their scrcpy 4.x equivalents
- Pass orientation as degrees instead of legacy indices
- Validate paired width/height fields before launch (#60)
- Report actual launch failure stderr instead of false success (#148, #145, #128, #124, #121, #120, #100, #95, #70)
- Resolve `scrcpy` and sibling `adb` consistently on macOS, Windows, and Linux (#109, #101)

### Security

- Enable Electron renderer sandboxing and context isolation
- Replace renderer Node access with a typed, restricted preload API
- Pass extra arguments directly without invoking a shell

## 1.5.1

- Added Traditional Chinese language support
- Fixed turn-screen-off behavior
