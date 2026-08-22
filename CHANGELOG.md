# Changelog

## Unreleased

### Fixed

- Clear the background-recording flags forced by the Record-only scene when returning to Screen, Camera, or Virtual display playback.
- Synchronize manual ADB device refreshes with the tracker snapshot so newly connected wireless devices are immediately available to device actions.

## 2.4.3

- Accept both LF and Windows CRLF line endings when verifying the packaged MIT license.
- Report project and upstream license verification failures separately.
- Supersede the unpublished `v2.4.2` tag, whose release workflow correctly stopped before publication when the Windows-only line-ending check failed.

## 2.4.2

This licensing and verification-tooling patch release applies the MIT License prospectively to Scrcpy GUI while preserving the separate licenses and notices of the bundled official scrcpy runtime. Releases through v2.4.1 remain under GPL-3.0-only.

### Changed

- Replace the project license with the OSI-approved MIT text after completing the current-tree contribution audit and maintainer ownership attestation.
- Package the Scrcpy GUI license and third-party notice as visible resources, and fail packaged-runtime smoke checks when either the GUI MIT text or bundled scrcpy Apache-2.0 text is missing.
- Remove an unused legacy tray icon that was the only remaining current-tree artifact from an otherwise removed external contribution.
- Add published installer lifecycle/startup verification, tagged beta migration fixtures, and a redacted physical-device preflight/runbook without claiming missing hardware results.

## 2.4.1

This GPL-3.0-only patch release ships the security and release-provenance improvements completed after v2.4.0. The planned MIT change is not included and remained pending completion of the current-tree contribution audit.

### Fixed

- Use explicit gzip streaming for `.tar.gz` bundles and bounded in-memory .NET ZIP extraction on Windows, avoiding platform-specific stdin behavior while keeping verified network archives off disk.

### Security

- Add private vulnerability-reporting guidance and weekly/push/PR CodeQL analysis for JavaScript and TypeScript.
- Reduce default Release workflow permissions, export a checksummed SPDX 2.3 SBOM, and generate GitHub/Sigstore build-provenance attestations for every release asset.
- Close file path-replacement races by validating and reading configuration, artifact indexes, and imported documents through one bounded descriptor, and stream checksum-verified scrcpy archives directly into the extractor without writing network bytes to a temporary archive.

## 2.4.0

This is the first stable release of the rebuilt Scrcpy GUI. It completes the M0–M4 software roadmap with the scrcpy 4.1 scene model, device workspace, local diagnostics, device groups, and bounded multi-device automation. See the release smoke report for the hardware, signing, and installer verification gaps that remain explicit rather than inferred.

### Added

- Model Camera, Virtual display, Record-only, Control-only, and OTG as validated launch scenes with official scrcpy 4.1 argv serialization, explicit conflicts, and portable Profile support.
- Probe and cache each device's video/audio encoders, displays, cameras, declared sizes, high-speed frame rates, facing, and zoom range with bounded partial-failure reporting.
- Configure all six launch scenes in a responsive guided workspace, including capability-backed Camera/Virtual display/Record-only controls, output preflight, and a separate no-ADB OTG preview/launch path.
- Save device groups with a default launch profile, description, stable device membership, and an explicit 1–8 target concurrency limit.
- Inspect launch, screenshot, app-start, safe control, file-push, APK-install, and Automation V2 batches in a per-device preflight table before execution.
- Build Automation V2 macros from bounded delay, control, normalized tap/swipe, non-sensitive text, app-start, screenshot, and device-assertion steps without accepting raw shell.
- Preview imported automations as untrusted documents, require an explicit review before saving, and keep sensitive text out of persisted macros.
- Cancel active automation batches with an abort signal, stop scheduling later steps, retain step-level events, and persist partial per-device run reports in the artifact library.
- Require explicit confirmation for multi-device input, remote-file overwrite, and APK downgrade batches.

## 2.0.0-beta.6

This release completes the device workspace, local artifact, diagnostic export, and portable profile workflows planned for M2.

### Added

- Add a device workspace with read-only device details, cached launchable app discovery/start, and reviewed multi-device file push and APK installation with bounded concurrency and per-target progress/results.
- Route new device operations through a shared argv-only ADB service and retain structured exit codes and package-manager details without exposing local source paths to the Renderer.
- Persist screenshots, recordings, and file/APK reports in a reconciled main-process artifact library with missing/incomplete states and narrow open, reveal, copy, index-removal, and confirmed file-deletion operations.
- Preview and export size-bounded local diagnostic ZIPs with default serial, address, path, and pairing-code redaction, then open a prefilled GitHub issue without uploading files or submitting on the user's behalf.
- Export versioned declarative launch profiles and import them through a dry-run compatibility, unknown-field, path, and name-conflict review with explicit replace/copy and machine-local path choices.

## 2.0.0-beta.5

This release completes the capability, configuration, device-tracking, command, and diagnostics foundations planned for M1.

### Added

- Detect supported scrcpy scenes and probe commands from the selected runtime's real `--help` output instead of assuming every build has the same capabilities.
- Store configuration in a validated, revisioned V3 file owned by the main process, with atomic replacement, backup recovery, and a non-destructive migration from beta local storage.
- Track ADB device snapshots in the main process with delta events, bounded frame decoding, exponential crash recovery, and a visibility-aware polling fallback.
- Build managed scrcpy arguments from a tested OptionDescriptor registry and show per-token configuration provenance plus expert-argument warnings in command previews.
- Correlate privileged operations with structured request IDs, typed failure envelopes, and a bounded main-process event stream that survives Renderer reloads and supports level/domain filtering.

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
