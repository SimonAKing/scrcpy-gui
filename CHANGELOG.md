# Changelog

## Unreleased

### Added

- Detect supported scrcpy scenes and probe commands from the selected runtime's real `--help` output instead of assuming every build has the same capabilities.
- Store configuration in a validated, revisioned V3 file owned by the main process, with atomic replacement, backup recovery, and a non-destructive migration from beta local storage.
- Track ADB device snapshots in the main process with delta events, bounded frame decoding, exponential crash recovery, and a visibility-aware polling fallback.
- Build managed scrcpy arguments from a tested OptionDescriptor registry and show per-token configuration provenance plus expert-argument warnings in command previews.

## 2.0.0-beta.4

This release establishes a secure, observable session foundation and replaces the remaining legacy application artwork.

### Added

- Preview the exact validated argv generated for each selected device before launch.
- Track every scrcpy launch as an independent session with an explicit startup lifecycle, PID, command, stop reason, and Sessions page.
- Cover long-running, early-exit, normal-exit, duplicate, missing-binary, and stop behavior with controlled child-process integration tests.

### Fixed

- Replace the blurred legacy tomato artwork with one high-resolution vector source and clean generated icons for Windows, macOS, Linux, and the tray.

### Security

- Validate every privileged IPC call against the main application frame and trusted renderer URL.
- Validate and normalize privileged IPC payloads at runtime, with bounded paths, device batches, expert arguments, and automations.
- Deny renderer permission requests, new windows, and navigation to untrusted locations.
- Apply a production-only Content Security Policy that removes development localhost access and blocks object, base, and form targets.

## 2.0.0-beta.3

### Changed

- Reworked Runtime setup into a compact two-level layout with actions above two equal status blocks.
- Shortened detected runtime versions to readable values while preserving the complete version output as a tooltip.

### Fixed

- Runtime action buttons no longer overflow the card at the default 1120-pixel window width.

## 2.0.0-beta.2

This release turns the complete historical issue sweep into concrete v2 features and restores the full project documentation.

### Added

- Verified official scrcpy 4.1 and adb bundles in every release package, with manual runtime override still available (#8, #10, #26, #70, #101, #116)
- Named launch profiles and per-device profile assignment for different resolutions, crops, windows, and options (#19, #80)
- Device aliases that also become the scrcpy window title when no explicit title is configured (#97)
- Saved wireless addresses, editable labels, and opt-in startup reconnection (#23, #93)
- Automatic selection of the first device and opt-in per-device automatic launch (#23)
- Clickable device controls for Back, Home, recent apps, Menu, volume, power, screen power, rotation, and touch indicators (#17, #84, #105, #131)
- PNG screenshots saved directly to the computer (#105)
- Safe ADB action recording and timed replay for simple automation (#130)
- Mouse and gamepad input modes for current scrcpy gaming/control workflows (#81, #85)
- Secondary Android display selection for DeX and similar desktop modes (#3)
- Explicit drag-and-drop destination, tunnel port range, video/audio buffering, and window aspect-ratio settings (#55, #68, #111, #115, #126, #146)
- Automatic timestamped recording filenames (#103)
- Configurable global Boss key that closes mirrors and hides the GUI (#149, #150)
- Optional ADB server shutdown on app quit (#102)
- Windows 32-bit installer/portable builds, Arch package, and portable Linux tarball (#32, #36)
- Chocolatey package source, CI validation, release `.nupkg`, and optional community publishing when `CHOCO_API_KEY` is configured (#139)

### Changed

- Reworked the interface into a calm native-light desktop layout with a persistent sidebar, a focused device flow, hidden unavailable controls, and six progressive Settings categories.
- Restored comprehensive English and Simplified Chinese READMEs with project background, complete feature coverage, platform installation, wired/wireless usage, shortcuts, troubleshooting, community, contribution, and sponsorship information.
- Recording, per-device launch, and runtime settings remain backward-compatible with beta.1 local storage through normalized defaults.
- Device screen-off/on controls prefer Android display power commands and fall back to key events on older systems.

### Fixed

- Device touch indicators can now be explicitly disabled after being enabled (#84).
- A saved device alias now affects the actual mirror title, not only the GUI card (#97).
- Per-device startup is guarded so refreshes or language changes cannot open duplicate mirror windows (#72, #114, #138).
- Recording can no longer silently overwrite the same filename when automatic naming is enabled (#103).
- Added validation for custom scrcpy tunnel port ranges.

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
